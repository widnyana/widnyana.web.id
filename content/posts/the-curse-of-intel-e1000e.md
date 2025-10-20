---
title: The Curse of Intel E1000e
date: 2025-04-04T04:36:45+07:00
draft: false
params:
  author: 'widnyana'
categories: ["technical", "linux", "networking"]
tags: ["linux", "intel e1000e", "network"]
---

## Understanding and Solving Intel E1000e Driver Issues

Intel's E1000e network driver has plagued Linux users for years, causing frustrating network connectivity issues, hardware unit hangs, and system instability. If you've encountered the dreaded "Hardware Unit Hang" error on your server or desktop, you're not alone. This post will help you understand these issues and provide practical solutions to resolve them.

## Common E1000e Issues and Error Messages

The E1000e driver issues typically manifest as:

- Hardware Unit Hang errors with TDH/TDT status information
- Phy reset blocked errors
- Network interface becoming unresponsive
- Problems particularly after resume from sleep
- NVM Checksum validation failures
- Module loading errors (-2, -5)

A typical error looks like this:

```
Apr 04 04:33:19 node02 kernel: e1000e 0000:00:1f.6 eno1: Detected Hardware Unit Hang:
                                 TDH                  <c4>
                                 TDT                  <ae>
                                 next_to_use          <ae>
                                 next_to_clean        <c3>
                               buffer_info[next_to_clean]:
                                 time_stamp           <10d0e5e88>
                                 next_to_watch        <c4>
                                 jiffies              <10d11ce40>
                                 next_to_watch.status <0>
                               MAC Status             <40080083>
                               PHY Status             <796d>
                               PHY 1000BASE-T Status  <3800>
                               PHY Extended Status    <3000>
                               PCI Status             <10>
Apr 04 04:33:19 node02 corosync-qdevice[2778753]: Can't connect to qnetd host. (-5986): Network address not available (in use?)
```

## Practical Solutions

### 1. Disable PCIe ASPM (Active State Power Management)

This is often the most effective solution for E1000e issues:

**Add kernel parameter:**
```
pcie_aspm=off
```

**Implementation:**
- Edit `/etc/default/grub`
- Add `pcie_aspm=off` to `GRUB_CMDLINE_LINUX_DEFAULT` parameter
- Run `sudo update-grub` 
- Reboot the system

### 2. Update the Driver

Download and install the latest Intel E1000e driver:

```bash
# Download latest driver from Intel's website
wget [driver_url_for_your_version]
tar -zxvf e1000e-*.tar.gz
cd e1000e-*/src/

# Modify Makefile line 152 if compilation fails:
# Change EXTRA_CFLAGS += $(CFLAGS_EXTRA) to EXTRA_CFLAGS += $(CFLAGS_EXTRA) -fno-pie
make install

# Remove and reload the module:
sudo rmmod e1000e && sudo modprobe e1000e
sudo update-initramfs -u
```

### 3. Fix Hardware-Specific Issues

#### For 82573 Chipset EEPROM Issues:
```bash
# Check if fix is needed
ethtool -e eth0
```
Look for offset 0x001e - if the value has bit 0 unset (like "de" instead of "df"), the EEPROM needs fixing.

Download and run the fix:
```bash
sudo bash fixeep-82573-dspd.sh eth0
```
Reboot after applying.

#### For NVM Checksum Issues:
When you see "e1000e: The NVM Checksum Is Not Valid" error:

**Solution:**
1. Download Intel Ethernet Connections Boot Utility from Intel's website
2. Extract BootUtil tool to a bootable medium
3. Boot from the device and run:
```bash
bootutil.exe -NIC=1 -DEFAULTCONFIG  # for DOS
./bootutil -NIC=1 -DEFAULTCONFIG   # for Linux
```

### 4. Reduce Ring Buffer Size
As a workaround to reduce hardware hangs without impacting performance:
```bash
sudo ethtool -G eth0 rx 256 tx 256
```

### 5. Blacklist or Modify Driver Parameters

Sometimes you can resolve issues by setting specific driver parameters:
```bash
# Create a modprobe configuration
echo 'options e1000e IntMode=0' | sudo tee /etc/modprobe.d/e1000e.conf
```

## Troubleshooting Commands

Quick diagnostic commands to help identify your specific issue:

```bash
# Check driver information
ethtool -i eth0

# Check dmesg for errors
dmesg | grep e1000e

# Check detailed registers
ethtool -d eth0
ethtool -c eth0  # Coalesce parameters

# Check PCI details
lspci -vvv -s [device_id]
```

## Background: The E1000e Driver Situation

The LWN article explains that the E1000e situation stems from having two separate drivers - the older `e1000` driver for PCI-based adapters and the newer `e1000e` driver for PCI-Express adapters. Some PCI-Express chipsets were added to the older driver before policy was standardized, creating code duplication where "two completely different bodies of code support the same hardware."

## BIOS Updates

In some cases, updating your system BIOS can resolve Intel E1000e network issues, particularly on Lenovo systems. The BIOS updates often include updated firmware for integrated network controllers.

## Conclusion

Intel E1000e driver issues, while frustrating, are manageable with the right approach. Start with the PCIe ASPM fix (most common solution), then try driver updates. For persistent hardware-specific issues, use the appropriate hardware-level fixes like EEPROM correction or NVM checksum fixes.

Remember to test your network connection after applying each solution, and document what worked for your specific setup. The E1000e driver issues have affected users across different distributions and hardware, but the solutions outlined here have proven effective for many users.

Always keep in mind that some fixes (like the NVM checksum fix) require you to potentially reinstall after kernel updates since older driver versions might be included in new kernel packages.

## References

- [ServerFault: Linux e1000e Intel networking driver problems](https://serverfault.com/questions/193114/linux-e1000e-intel-networking-driver-problems-galore-where-do-i-start)
- [Proxmox Forum: Intel NIC e1000e Hardware Unit Hang](https://forum.proxmox.com/threads/intel-nic-e1000e-hardware-unit-hang.106001/)
- [LWN: Intel e1000e driver development article](https://lwn.net/Articles/278016/)
- [AskUbuntu: Intel e1000e ethernet not working](https://askubuntu.com/questions/650953/intel-e1000e-ethernet-not-working)
- [MyNIXWorld: E1000e The NVM checksum is not valid](https://mynixworld.info/2012/12/05/e1000e-the-nvm-checksum-is-not-valid/)
- [Lenovo Support: BIOS update for ThinkCentre systems with Intel NICs](https://pcsupport.lenovo.com/id/en/products/desktops-and-all-in-ones/thinkcentre-m-series-desktops/m720q/10t8/10t8sa4j00/pc15amf2/downloads/ds503907-flash-bios-update-thinkcentre-m720t-m720s-m720q-m920t-m920s-m920q-m920x-thinkstation-p330-tiny?category=BIOS%2FUEFI)
