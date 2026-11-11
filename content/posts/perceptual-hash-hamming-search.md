---
title: "Hamming search over 26,000 perceptual hashes: the index I built lost to comparing every pair"
date: 2026-11-16T09:00:00+07:00
draft: true
params:
  author: 'widnyana'
description: "26,487 perceptual hashes and a distance limit of 10 bits is 350 million comparisons. I built a pigeonhole bucket index expecting five times fewer checks, then measured it: on real hashes the index removed 44 percent of the comparisons and ran 2 to 4 times slower than doing all of them. Here are the numbers, and the real bug the exercise found."
showToc: true
tags:
  - algorithms
  - perceptual-hashing
  - similarity-search
  - gpu
  - swift
categories:
  - Architecture
keywords:
  - hamming distance search
  - perceptual hash similarity search
  - near duplicate image detection
  - pigeonhole principle hash bucket
  - multi-index hashing
  - O(n^2) pair comparison benchmark
  - metal compute hamming tiles
cover:
  image: /images/perceptual-hash-hamming-search-cover.png
  alt: "A dark cover reading '350,767,341 comparisons.' above a card with the measured GPU and CPU times"
---

This post searches perceptual hashes. [Perceptual hash from scratch](/posts/perceptual-hash-dct-explained/) explains how one is built, and the [GPU hashing post](/posts/metal-threadgroup-per-image/) covers computing 26,000 of them fast.

26,487 perceptual hashes, a 64-bit fingerprint per image, and a rule: two images are near duplicates when their hashes differ in at most 10 bits. Comparing every hash against every other is

```text
n * (n - 1) / 2 = 350,767,341
```

comparisons on a 115 GB working folder.

That number looks like a problem worth designing around. So I designed around it: split each hash into 11 bit-ranges, bucket the hashes by range value, and only compare inside a bucket. The pigeonhole argument says no pair can be missed. On paper it should compare about a fifth of the pairs.

Then I measured it. Every number below is from the same folder, the same 26,487 hashes, and a release build:

|Approach|Pairs found|Wall time|Peak RSS|
|---|---|---|---|
|Compare every pair, one CPU thread|12,818,664|0.254 s|617 MB|
|Compare every pair, tiled on the GPU|12,818,664|0.133 s|827 MB|
|Bucket index, `Set` dedupe|12,818,664|10.2 s|1,135 MB|
|Bucket index, chunk-order dedupe|12,818,664|0.52 s|523 MB|

All four return exactly the same 12,818,664 pairs. The index is the slowest of the four. The version with the tuned dedupe is still twice as slow as a single-threaded nested loop, and four times slower than the GPU.

## The arithmetic that looked convincing

The argument is the pigeonhole principle applied to bits. Two hashes within distance `d` differ in at most `d` positions. Split the 64 bits into `d + 1` ranges, and at most `d` of those ranges can contain a difference, so at least one range is identical between them.

With `d = 10` that is 11 ranges over 64 bits, 9 of 6 bits and 2 of 5 bits. Build one dictionary per range, keyed by the range's bits, and compare the hashes that land in the same bucket. A pair is verified with the real hamming check and deduplicated across ranges.

The expected saving comes from uniform hashing: two random 64-bit values share a 6-bit range with probability `2^-6`, so a 6-bit range contributes about `n^2 / 2^7` candidates. Summing over 9 ranges of 6 bits and 2 of 5 bits:

```text
9 / 64 + 2 / 32 = 0.203
```

About a fifth of the pairs, or 71 million checks instead of 350 million. That is the number I believed.

## Real perceptual hashes are not uniform

The measured candidate count on the real folder was 197,688,254: 56 percent of all pairs, not 20 percent. The index removed fewer than half of the comparisons.

The reason is in the data, not the formula. A perceptual hash encodes a 32 x 32 grayscale thumbnail's low-frequency content. Wallpapers, flat backgrounds, screenshots, dark frames, and images with a dominant single tone collapse to the same few hash values, and those values land in the same buckets in every range. The uniform assumption is exactly wrong for the input that matters.

This one measurement invalidated the case for the index. The rest of the post confirms it.

## Dedupe was the first trap, and it was mine

The first version collected verified pairs and deduplicated them with a `Set<UInt64>`, packing each pair into `low << 32 | high`. That version took 10.2 seconds and 1.1 GB of memory.

The pairs themselves are not the problem: 12.8 million verified pairs is about 200 MB as plain tuples. The problem is 197 million `Set.contains` calls: each one hashes a 64-bit key, masks it, and probes a table that no longer fits in cache. The set grew to tens of millions of slots, so every probe was a memory round trip.

The second version removed the set entirely. A pair that matches in several ranges is emitted only in the first matching range, which costs a short shift-and-compare loop per candidate and no allocation:

```swift
let xor = hashes[low] ^ hashes[high]
guard xor.nonzeroBitCount <= maxDistance else { continue }
var emitted = false
for earlier in 0..<chunk {
    let slice = chunks[earlier]
    let mask = slice.count == 64 ? ~UInt64(0) : (UInt64(1) << UInt64(slice.count)) - 1
    if (xor >> UInt64(slice.lowerBound)) & mask == 0 {
        emitted = true
        break
    }
}
if emitted { continue }
keys.append(UInt64(low) << 32 | UInt64(high))
```

That bought 0.52 seconds and 523 MB, a 20 times speedup over the `Set` version, and it is still slower than comparing every pair.

## Why the plain loop wins

350 million hamming comparisons sounds heavy. It is not, because the operation is small and the data is small with it. 26,487 hashes is 212 KB, which fits in the last-level cache of the machine, so the nested loop streams a resident array and does one XOR, one popcount, and one compare per cell. That measured 0.254 seconds on one core, roughly 1.4 billion comparisons a second.

The index pays three costs the plain loop does not:

- Build 11 dictionaries per pass, each with n entries, each insertion hashing a key.
- Touch the hash array through bucket order, which is not sequential.
- Deduplicate, which either costs allocations and memory probes or costs the chunk-order scan above.

Those costs are bigger than the 44 percent of comparisons the index saves. On uniformly distributed hashes the index would save 80 percent, and it might win. On real photo libraries it saves less than half, and it loses.

## The bug the measurement actually found

The exercise was not wasted, because it surfaced a real defect in the code path that shipped before it. The GPU pair search wrote all results into one fixed buffer of 1,048,576 pairs and threw when the library produced more. This folder produces 12,818,664 pairs, so that path would have failed outright, and the count is not exotic: one cluster of 5,000 near-identical images is 12.5 million pairs on its own.

The fix is to drain the buffer per tile instead of per call. The kernel already wrote into a shared buffer with an atomic counter; each tile now resets the counter, runs one command buffer, and copies its results out before the next tile starts:

```swift
found.contents().storeBytes(of: UInt32(0), as: UInt32.self)
try context.run("hamming_pairs", grid: grid) { encoder in
    // hashes, count, distance, found, pairs, capacity, tile origin
}
let total = Int(found.contents().load(as: UInt32.self))
for index in 0..<total {
    result.append((Int(values[index * 2]), Int(values[index * 2 + 1])))
}
```

A 2048 x 2048 tile can report at most 2,097,152 pairs, which sizes the buffer at 16 MB for the whole run. The total pair count is then bounded by the library and not by an allocation decision. The measured effect: 0.133 seconds for 12.8 million pairs, longest GPU submission 0.99 ms, and no cap.

## When the index would win, and what I would do instead

The index is the right structure when the comparison itself is expensive or the candidate fraction is genuinely small. Neither holds here:

- Distance: at `d = 10` on 64 bits the chunks are 5 and 6 bits, so buckets hold about `n/64` hashes each and the candidate fraction stays near half on clustered data. A smaller distance with more chunks would cut candidates, but the caller sets the distance, not the search.
- Scale: at the measured rate of about 1.4 billion comparisons a second, 350 million comparisons costs a quarter second. Extrapolated, 100,000 hashes is 5 billion comparisons and 3.6 seconds on one core, and only around that size does an index start to pay for its bookkeeping.
- Exactness: everything here is exact. Approximate structures (locality sensitive hashing, random projection) would cut the work further and give up the guarantee, which is not a trade a duplicate finder should make quietly.

Measure the constant before choosing the algorithm. 350 million comparisons is 0.25 seconds on one core and 0.13 seconds on the GPU, so the pair search was never the bottleneck in that photo step. The fixed buffer was.
