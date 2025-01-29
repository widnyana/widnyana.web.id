---
title: 'Monitoring Stack With Mikrotik Included'
publishdate: 2025-01-22T15:32:34+07:00
draft: false
params: 
  author: 'widnyana'
description: "Automating the setup of a complete monitoring stack for MikroTik and more."
tags:
 - grafana
 - prometheus
 - docker
 - monitoring
 - mikrotik
cover:
  image: /images/mikrotik-grafana.png
---

This project automates setting up a complete monitoring stack with just a few commands.

## Why Monitor MikroTik?

MikroTik routers are critical network components. Monitoring them helps you:
- Catch network issues before users complain
- Track bandwidth usage and identify bottlenecks
- Monitor CPU and memory load for capacity planning
- Get alerts when devices go down or perform poorly
- Analyze long-term network trends for better decision making

## Smart Database Choice

I use PostgreSQL instead of the default SQLite because:
- Better performance with large monitoring datasets
- Multiple Grafana instances can share the same database
- Built-in backup and replication capabilities
- Handles concurrent queries much better
- Reliable for long-term metrics storage

## Pre-Built Dashboards

Grafana comes pre-configured with useful dashboards:
- MikroTik device overview with CPU, memory, and disk metrics
- Network interface monitoring with bandwidth graphs
- System health indicators and alerts
- Resource utilization trends


## About MKTXP (MikroTik Exporter)

[MKTXP](https://github.com/akpw/mktxp) is a specialized Prometheus exporter for MikroTik devices that:
- Collects metrics via MikroTik's API
- Has minimal performance impact on your devices
- Provides detailed metrics about interfaces, resources, and system health
- Supports multiple devices with a single instance
- Highly configurable with fine-grained metric selection

## Setting Up MikroTik User Access

To ensure security, create a dedicated user with minimum required permissions:

1. Via CLI:
```routeros
/user group add name=mktxp_group policy=api,read
/user add name=mktxp_user group=mktxp_group password=mktxp_user_password
```

> Note: Consider changing the default 'mktxp_user_password' to something more secure in production environments.

2. Via WebFig/WinBox:
   - Go to System > Users
   - Create new group `mktxp_group` with only **API** and **Read** permissions
   - Add new user `mktxp_user` and assign to `mktxp_group`
   - Set a strong password

## Why These Permissions?

- `api`: Allows MKTXP to connect to the RouterOS API
- `read`: Enables reading device metrics and configuration
- No write permissions: Ensures monitoring can't modify your device

Once configured, your Grafana dashboards will automatically start showing MikroTik metrics. The pre-configured dashboards include interface traffic, CPU usage, memory utilization, and more.

## How it Works

1. Run `make init` to start setup
2. The script will:
   - Check your Docker installation
   - Create data directories
   - Get your database credentials
   - Configure Grafana and its dashboards
   - Set up MikroTik monitoring
   - Optionally add Nginx Proxy Manager

## Getting Started

Then run these commands:
```bash
git clone https://github.com/widnyana/monitoring-stack.git monitoring-stack
cd monitoring-stack/sentinel
make init    # First-time setup
```

The script will ask various questions, and will tell you how to run the stack after finished.

That's it! Your monitoring system is ready to go. Connect to Grafana and your dashboards are waiting for you.

Note: Clean everything with `make clean` if needed.