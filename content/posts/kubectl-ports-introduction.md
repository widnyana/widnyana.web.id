---
title: "Introducing kubectl-ports: Easily List Exposed Ports in Kubernetes"
date: 2024-10-10T21:30:00+07:00
description: "kubectl-ports is a handy kubectl plugin that retrieves exposed ports information from Kubernetes pods and services, presenting it in a clean, readable table format."
params:
  author: 'widnyana'
cover:
  image: "https://images.unsplash.com/photo-1521616210349-dbec8efd13b4?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
  # can also paste direct link from external site
  # ex. https://i.ibb.co/K0HVPBd/paper-mod-profilemode.png
  alt: "Port"
  caption: "Photo by <a href='https://unsplash.com/@czarotg?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash'>Cezary Kukowka</a> on <a href='https://unsplash.com/photos/brown-galleon-ship-on-deck-MIpS1kkW-oA?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash'>Unsplash</a>"
  relative: false
  responsiveImages: true
tags: ["kubernetes", "kubectl", "site Reliability engineering", "networking", "command-line", "opensource", "cloud-infrastructure"]
categories: ["Command Line", "Kubernetes", "DevOps"]
--- 

As a Kubernetes user, have you ever found yourself digging through resource definitions or running multiple commands just to find out what ports are exposed by your pods and services? It can be a tedious process. That's why I created `kubectl-ports`, a handy kubectl plugin that retrieves the exposed ports information and presents it in a clean, readable table format.

## What is kubectl-ports?

`kubectl-ports` is a tool that leverages the `kube-rs` SDK to retrieve information about running pods in a Kubernetes cluster. It filters out the relevant port details from each pod and prints the final result in an easy-to-read table. No more combing through verbose output or chaining together multiple commands!

## Why I Built It

I frequently found myself needing to check what ports were exposed by various Kubernetes resources, whether for debugging network issues, verifying service configurations, or simply getting a high-level overview. The standard `kubectl` commands provided the information I needed, but not in the most user-friendly format. I wanted a tool that would cut through the noise and give me the port details at a glance.

## Installation and Usage

`kubectl-ports` can be installed in two ways:

1. Using cargo:

```bash
cargo install kubectl-ports
```

2. **SOON!** Using [kubectl krew](https://krew.sigs.k8s.io/), the plugin manager for kubectl:

```bash
kubectl krew install ports
```

3. Manually compile it by yourself:

```bash
git clone https://github.com/widnyana/kubectl-ports-rs
cd kubectl-ports-rs
make build install clean
```

After installation, ensure you have `kubectl` configured to connect to your Kubernetes cluster. 

Using `kubectl-ports` is simple. Just run the command followed by the resource type you want to list ports for. The currently supported resources are:

- `pod` (default) 
- `service` or `svc`

For example, to list ports exposed by pods in the `kube-system` namespace:

```bash
kubectl ports -n kube-system
```

This will output a table like:

```
+===============+==========================================+========================+==================+===================+
|   Namespace   |                 Pod Name                 |     Container name     |  Container Port  |     Port Name     |
+===============+==========================================+========================+==================+===================+
|  kube-system  |  fluentbit-gke-46dgf                     |  fluentbit             |  2020/TCP        |  metrics          |
+---------------+------------------------------------------+------------------------+------------------+-------------------+
|  kube-system  |  fluentbit-gke-46dgf                     |  fluentbit-gke         |  2021/TCP        |  metrics          |
+---------------+------------------------------------------+------------------------+------------------+-------------------+
...
```

To list ports exposed by services:

```bash
kubectl ports -n kube-system svc
```

Which will output something like:

```
+===============+========================+=============+=================+=============+===============+================+=============+
|   Namespace   |      Service Name      |    Type     |   Cluster IP    |  Port Name  |  Target Port  |  Exposed Port  |  Node Port  |
+===============+========================+=============+=================+=============+===============+================+=============+
|  kube-system  |  default-http-backend  |  NodePort   |  172.23.5.200   |    http     |  8080/TCP     |  80/TCP        |  32725/TCP  |
+---------------+------------------------+-------------+-----------------+-------------+---------------+----------------+-------------+
...  
```

## Benefits

The key advantages of using `kubectl-ports` are:

1. **Simplified Port Discovery**: No need to manually parse through the output of `kubectl describe` or other verbose commands. `kubectl-ports` extracts just the port information you need.

2. **Clean and Readable Output**: The table format makes it easy to quickly scan and find the port details you're looking for.

3. **Namespace Filtering**: Use the `-n` flag to limit the output to resources in a specific namespace. 

4. **Support for Pods and Services**: Whether you need to list ports for pods, services, or both, `kubectl-ports` has you covered.

## Conclusion

If you're a Kubernetes user looking to streamline your workflow and simplify the process of finding exposed ports, give `kubectl-ports` a try. It's a small but mighty tool that can save you time and frustration. The project is open source, so feel free to contribute or suggest improvements on the [GitHub repository](https://github.com/widnyana/kubectl-ports-rs).

Happy port listing!