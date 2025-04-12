---
title: "Connect WiFi without GUI on Debian Linux"
date: 2025-04-13T01:49:50+07:00
description: "Learn how to connect to Wi-Fi on Debian Linux using only the terminal — perfect for headless servers, Proxmox setups, and minimal environments without a graphical user interface (GUI) to help you get online quickly and reliably."
params:
  author: 'widnyana'
cover:
  image: "https://images.unsplash.com/photo-1600238454024-bc8c1e49caba?q=80&w=2065&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
  alt: "wireless"
  caption: "Markus Spiske on Unsplash - https://unsplash.com/photos/green-and-white-labeled-box-L-mHnEJXR6A"
  relative: false
  responsiveImages: true
tags: ["debian", "wifi", "command-line", "linux", "networking"]
categories: ["Command Line", "Notes"]
--- 

## Install Required Tools

```sh
apt install \
	wpasupplicant \
	wireless-tools \
	--no-install-recommends
```

## Identify your wireless interface

First, let’s figure out your wireless interface name using 

```sh
ip link
```

You’ll see output like this:

```sh
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: eno1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc pfifo_fast master vmbr0 state UP mode DEFAULT group default qlen 1000
    link/ether 98:fa:9b:31:a4:h6 brd ff:ff:ff:ff:ff:ff
    altname enp0s31f6
3: wlp2s0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ether d0:ab:d5:11:4r:5c brd ff:ff:ff:ff:ff:ff
```

Look for the line that starts with something like `wl????` — that’s your **wireless interface**. In this example, it's `wlp2s0`. Make a note of it, you’ll use it in the next steps.

## Configure WPA Auth

```sh
wpa_passphrase SSID_NAME PASSPHRASE \
	| tee -a /etc/wpa_supplicant/wpa_supplicant.conf
```

You might need to add these lines too at the beginning of the file:

```ini
update_config=1                                 # allow wpa_supplicant to update (overwrite) configuration
country=COUNTRY_CODE                            # please refers to ISO/IEC alpha2 country code
ctrl_interface=DIR=/run/wpa_supplicant GROUP=0
```

 Other options can be seen on this link: https://w1.fi/cgit/hostap/plain/wpa_supplicant/wpa_supplicant.conf

For comparison, this is what I've got:

```ini
update_config=1
country=ID
ctrl_interface=DIR=/run/wpa_supplicant GROUP=0

network={
        ssid="REDACTED"
        #psk="REDACTED"
        psk=REDACTED
        scan_ssid=1
        proto=RSN
        key_mgmt=WPA-PSK
        group=CCMP
        pairwise=CCMP
        priority=10
}
```
## Configure Network Interfaces


Open the `/etc/network/interfaces` file, and update it with your network details. Use the example below as a template and adjust it to match your Wi-Fi interface name, SSID, and other settings:

```ini
auto wlp2s0              # change this to your interface name
iface wlp2s0 inet dhcp   # this one too
	wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf    # path to wpa-supplicant config file
    dns-nameservers 1.1.1.1 9.9.9.9                     # DNS server you want to use
```

## Put them to actions

Now after wpa_supplicant and network interface being configured, time to apply the update.

```sh
systemctl enable --now wpa_supplicant.service    # refresh the configs

systemctl restart networking.service             # you might need to wait a couple seconds here
```

## Check the result

Use command below to confirm does the interface got IP from DHCP server or not:

```sh
ip addr show [INTERFACE NAME]

# example
ip addr show wlp2s0
```

That's it, you've successfully configure Wireless Connection on Linux.