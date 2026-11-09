---
title: "3 Metal mistakes that made my Mac GPU code 4x slower and ate 6.9 GB"
date: 2026-11-12T09:00:00+07:00
draft: true
params:
  author: 'widnyana'
description: "A photo hashing step took 329 s and held 6.9 GB. One GPU thread hashed a whole image, every bitmap was copied by the CPU into a shared buffer, and every batch allocated fresh Metal buffers. How threadgroup sizing, decode-into-buffer, and one reused buffer set changed it to 84 s and 1.23 GB."
showToc: true
tags:
  - metal
  - gpu
  - swift
  - macos
  - performance
  - imageio
categories:
  - Architecture
keywords:
  - metal compute kernel threadgroup size
  - dispatchThreadgroups vs dispatchThreads
  - MTLBuffer reuse per scan
  - ImageIO decode into metal buffer
  - kCGImageSourceShouldCache false memory
  - metal kernel one thread per image slow
  - unified memory shared storage mode
cover:
  image: /images/metal-threadgroup-per-image-cover.png
  alt: "A dark cover reading '3 GPU mistakes. 4x slower.' above a before and after card: 329 s and 6.9 GB, then 84 s and 1.23 GB"
---

New to perceptual hashes? [Perceptual hash from scratch](/posts/perceptual-hash-dct-explained/) explains the algorithm this post runs on the GPU.

A macOS disk cleanup tool has one step that hashes photos so it can find near duplicates. On a 115 GB working folder with 26,553 images it took 329 seconds and pushed the process footprint to 6.9 GB.

The step was correct. Every hash matched the CPU reference, every duplicate was found. It was also the longest step in the scan and the largest consumer of memory.

The GPU profile showed two things that are easy to misread:

- The kernel ran 32 threads in total. One thread hashed one whole image, 65,536 pixels at a time.
- The longest single GPU submission was 22.6 ms, and the CPU sat waiting for it. The GPU was not saturated, it was barely used.

That also rules out the kernel as the whole story. 26,553 images in batches of 32 is 830 submissions, and 830 times the 22.6 ms maximum is under 20 seconds of GPU time. The other 300 seconds were CPU time in decoding and in copying bitmaps. Three mistakes on the GPU side, not one: a serial kernel, a per-image copy into GPU memory, and a fresh buffer set per batch. The decode pool was the fourth knob, on the CPU side.

An Apple Silicon laptop, 8 cores, 16 GB. Everything below was measured on it.

## The kernel ran one thread per image

The old kernel took an image id from `thread_position_in_grid` and walked all 65,536 pixels of that image in a serial loop:

```metal
kernel void photo_features(device const uchar *rgba [[buffer(0)]],
                           device const ulong *cosTable [[buffer(1)]],
                           device ulong *hashes [[buffer(2)]],
                           uint imageID [[thread_position_in_grid]]) {
    // one thread, 65,536 pixels, 1,024 grayscale cells, 64 DCT coefficients, then the hash bit
}
```

The host side asked for one thread per image:

```swift
encoder.dispatchThreads(
    MTLSize(width: count, height: 1, depth: 1),
    threadsPerThreadgroup: MTLSize(width: count, height: 1, depth: 1))
```

With `count` equal to the batch size of 32, the requested grid was 32 threads and the threadgroup was also 32 threads. That is one SIMD group, which runs on one GPU core and leaves every other core idle, and then the CPU blocked until the command buffer finished.

This is the shape of bug that survives review, because it is not wrong. It produces the correct answer while using one core out of the ones the chip has, and `Correct` plus `slow` looks like `the GPU is not that fast`.

## What Apple's own sizing note says

Two rules from the official guidance decided the rewrite. Both are in the notes on calculating threadgroup and grid sizes and on synchronizing CPU and GPU work:

1. Size a threadgroup from the pipeline's `threadExecutionWidth` and `maxTotalThreadsPerThreadgroup`. Do not pick a number because it looks round.
2. Submit as few command buffers as possible, and move as much work into each one as the hardware allows, without letting a single submission block the rest of the system.

The second rule matters here because the GPU is shared with the window server. A submission that runs for a second is a visible stutter. A submission that runs for a few milliseconds is invisible. The rewrite keeps every submission under 3 ms while still batching dozens of images into it.

## Split one image across 256 threads

The new kernel runs one threadgroup per image, 256 threads in the group, and lets those threads cooperate through threadgroup memory. Five phases, four barriers:

1. **Grayscale cells.** 1,024 cells of a 32 x 32 downsample, 4 per thread. Each cell averages an 8 x 8 pixel block.
2. **Row transform.** 256 threads compute `rows[y * 8 + u]`, one dot product per thread over 32 cells.
3. **Column transform.** 64 threads compute `coef[v * 8 + u]` from the row results.
4. **Median and hash bits.** Thread 0 insertion-sorts the 64 coefficients, takes the median of the middle pair, and sets a bit for each coefficient above it.
5. **Laplacian.** All 256 threads walk the 254 x 254 interior, accumulate a sum and a sum of squares, then a tree reduction over threadgroup memory combines them.

Threadgroup memory is about 9.5 KB per image: 4,096 bytes for the cells, 1,024 for the rows, 512 for the coefficients, 8 for the median pair, and 2,048 bytes for each of the two reduction arrays.

The shape of the kernel, with the per-phase bodies elided:

```metal
kernel void photo_features(device const uchar *rgba [[buffer(0)]],
                           device const int *cosTable [[buffer(1)]],
                           device ulong *hashes [[buffer(2)]],
                           device long *lap [[buffer(3)]],
                           uint imageID [[threadgroup_position_in_grid]],
                           uint tid [[thread_position_in_threadgroup]]) {
    threadgroup int cells[32 * 32];
    threadgroup int rows[32 * 8];
    threadgroup long coef[64];
    threadgroup long reduceSum[256];
    threadgroup long reduceSquares[256];

    for (int c = tid; c < 32 * 32; c += 256) { cells[c] = blockAverage(...); }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    if (tid < 32 * 8) { rows[tid] = rowDot(cells, cosTable, tid); }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    if (tid < 64) { coef[tid] = columnDot(rows, cosTable, tid); }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    if (tid == 0) { hashes[imageID] = medianHash(coef); }
    threadgroup_barrier(mem_flags::mem_threadgroup);

    long sum = 0;
    long squares = 0;
    for (int p = tid; p < 254 * 254; p += 256) { /* laplacian */ }
    reduceSum[tid] = sum;
    reduceSquares[tid] = squares;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint stride = 128; stride > 0; stride >>= 1) {
        if (tid < stride) {
            reduceSum[tid] += reduceSum[tid + stride];
            reduceSquares[tid] += reduceSquares[tid + stride];
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
}
```

One caveat on rule 1. The 256 is a constant declared in the shader and matched by `PerceptualHash.photoThreads` on the host, not a value read from the pipeline at runtime. It fits under the `maxTotalThreadsPerThreadgroup` the pipeline reports here, but a device that reported less would need the constant lowered together with the array sizes. The flat kernels, the pair search included, do derive their threadgroup from `threadExecutionWidth` at dispatch time.

The output is bit-identical to the CPU path, and that is not luck. Every reduction is an integer sum, and an integer sum does not care about the order of its terms. The median is computed by one thread, so no tie-breaking race exists. A test hashes the same fixture on both paths and compares the hash, the Laplacian sum, and the Laplacian squares exactly.

The host side changed from `dispatchThreads` to `dispatchThreadgroups`, because the grid is now groups of cooperating threads, not independent threads:

```swift
encoder.dispatchThreadgroups(
    MTLSize(width: count, height: 1, depth: 1),
    threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
```

One submission now runs `count * 256` threads. With 64 images per batch that is 16,384 threads, which is enough to fill the machine, and the submission still completes in under 3 ms because each thread does about 256 pixels of work instead of 65,536.

## Stop copying the bitmap

The second defect was easier to see in the memory profile than in the CPU profile. Each image was decoded into a Swift byte array and then copied into the shared Metal buffer:

```swift
// before: allocate 256 KiB on the CPU, then copy it into GPU-visible memory
let rgba = decodeThumbnail(url)
rgba.withUnsafeBytes { bytes in
    input.contents().advanced(by: index * imageBytes).copyMemory(from: bytes.baseAddress!, byteCount: imageBytes)
}
```

256 KiB per image, 26,553 images, 6.96 GB of `memcpy` over the folder. That copy is pure overhead: unified memory means the GPU reads the same physical pages the CPU writes.

The fix is to decode directly into the buffer the GPU will read. `CGContext` accepts caller-supplied memory, so the draw lands where the kernel expects it:

```swift
guard let context = CGContext(
    data: input.contents().advanced(by: index * imageBytes),
    width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 256 * 4,
    space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { return nil }
context.draw(thumbnail, in: CGRect(x: 0, y: 0, width: 256, height: 256))
```

Two supporting settings make it stick:

- `kCGImageSourceShouldCache: false` on the source. Without it, ImageIO caches the full decoded image, which is many times the size of the thumbnail we asked for.
- One `autoreleasepool` per image. ImageIO holds decode buffers in the pool. One pool around the whole photo step means 26,553 images' worth of decode state stays alive to the end.

The copies stopped. So did most of the memory growth, because a decode that writes into a reused 16 MB buffer leaves nothing behind.

## One buffer set per scan, 64 images per submission

The third defect was allocation churn. Every batch called `makeBatchBuffers`, which allocated a fresh input buffer, hash buffer, Laplacian buffer, and coefficient table. The batches were small, so this happened 830 times over the scan, and each set stayed alive in Metal's residency pool. That is the 6.9 GB peak more than any single decode.

Now the scan allocates one set sized for 64 images and reuses it for every batch: 16 MB of input, 512 bytes of hashes, 1 KB of Laplacian sums. The table is uploaded once. Batch 400 touches the same pages batch 1 touched.

Batching is the other half. A batch of 64 images at 256 threads each is 16,384 threads per submission, which is wide enough to occupy the GPU and still finishes in a few milliseconds. Larger batches would move the same data with fewer submissions, but a longer submission is a longer stall for whatever else is drawing on that GPU.

## Six decoders beat four, eight beat six but cost headroom

Decoding is the CPU-bound half, and it runs on a bounded pool of workers that decode straight into the shared buffer slots. The pool size is the one number worth tuning, because decode is where the remaining time goes once the GPU side is cheap. Measured on the same 26,553 images:

|Decode workers|Photo step|Footprint peak|
|---|---|---|
|4|97.6 s|0.99 GB|
|6|84.0 s|1.23 GB|
|8|78.4 s|1.33 GB|

Eight workers is 6.7 percent faster than six and 100 MB heavier. The scan has a hard gate at 1.5 GB peak RSS, and that gate exists because this runs on a user's machine while they work. Six was chosen for headroom under that gate, not because it is the fastest. The table also stops at 8: past that, decode contention between workers was not measured.

## What it measures

|Measurement|Before|After|
|---|---|---|
|Photo step, 26,553 images|329.0 s|84.0 s|
|Step footprint, peak|6.9 GB|1.23 GB|
|Longest GPU submission|22.6 ms|2.8 ms|
|Whole scan|427.5 s|184.4 s|
|600-image fixture, time|10.5 s|1.3 s|
|600-image fixture, RSS|190 MB|63.5 MB|

The photo step is 3.9 times faster and fits in less than a fifth of the memory. The whole scan fell by 243.1 s against the photo step's 245.0 s, so everything else in the scan moved by about 2 s in total, which is the resolution of this measurement.

How these were taken:

- `vmmap -summary` against the running process every 3 seconds, recording `Physical footprint`. That is the step footprint curve, and its maximum is the peak in the table.
- `/usr/bin/time -l` for peak RSS of the whole process, which is what the gate checks.
- Time Profiler for where the wall time went, and a per-command-buffer timer inside the GPU wrapper for the submission duration. The timer is part of the app: the scan fails its own benchmark if one submission exceeds 50 ms.
- Every number comes from the same folder, the same machine, and a release build.

The 600-image fixture is a separate folder, 1/44 of the large one, used as a check that the same shape holds at a different size. It does not prove anything about caching: it proves the change was not specific to one folder's mix of file sizes.

A later re-measure of the same step, after two further changes (the allocator relief described below, and a fixed pair buffer in the near-duplicate search), gave 77.2 s for the photo step, 172.9 s for the whole scan, and 1.29 GB peak RSS against the same 1.5 GB gate. That is a separate run on a later state of the folder, not a continuation of the table above.

## What still sits in memory

Two things dominated the footprint after the rewrite:

- About 9 MB in `IOAccelerator`, which is the driver's own allocation and not something app code controls.
- About 597 MB in `Malloc Large (empty)` after the photo step finished. These are decode slabs that ImageIO freed. The allocator kept them on its free list instead of returning them to the operating system. Empty means free, and free pages still count against the footprint.

The second one is fixable from app code. `malloc_zone_pressure_relief(nil, 0)` asks the allocator to return free pages across every zone:

```swift
@discardableResult
public static func releaseFreePages() -> Int {
    Int(malloc_zone_pressure_relief(nil, 0))
}
```

A null zone means all zones, and a zero goal means ask for as much as it can give. The scan calls it once every eight batches and once when the photo loop ends. It allocates nothing and changes no result, and it cannot raise the peak: it returns only pages that are already free. What it can cost is time, because a page handed back to the kernel is faulted in again if the allocator needs it later. That trade is the whole design question, and it is worth its own write-up, because the profile you get before the call looks exactly like a leak and is not one.

The general shape is worth remembering: a GPU step can be fast, correct, and still the biggest thing on the machine, because the cost moved from arithmetic to allocation and copy. Measure the footprint with the time, or you will fix half of the problem and call it done.
