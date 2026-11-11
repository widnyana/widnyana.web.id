---
title: "Use Backblaze as an OpenTofu backend"
date: 2025-01-20T14:51:11+07:00
draft: false
params: 
  author: 'widnyana'
description: "Configuring OpenTofu to use Backblaze S3 as state storage"
tags:
 - opentofu
 - terraform
 - iac
 - backblaze
cover:
  image: /images/opentofu-logo-large.png
---



### Using Backblaze B2 as State Storage for OpenTofu

Infrastructure as Code (IaC) tools like **OpenTofu** rely on state files to keep track of the resources they manage. The state file is how OpenTofu knows what’s already been deployed, updated, or destroyed. Backblaze B2 is a cost-effective place to store them.

Configuring OpenTofu to use Backblaze B2 is almost identical to setting up Amazon S3 as the backend, with a small tweak.

---

### Why Choose Backblaze B2?

1. **Cost Savings:** Backblaze B2 offers cloud storage at a fraction of the cost of traditional providers.
2. **S3 Compatibility:** Fully supports the S3 API, so you can reuse familiar configurations.
3. **Performance and Reliability:** Runs on Backblaze's storage infrastructure.

If you already know S3, this will feel familiar.

---

### The Configuration

Configure OpenTofu to store its state file in Backblaze B2:

1. **Set Up Your Backend Configuration**

In your `terraform` block, define the backend as `s3` and provide Backblaze-specific settings. 

```hcl
terraform {
  backend "s3" {
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    skip_region_validation      = true

    endpoints = {
      s3 = "https://s3.us-west-002.backblazeb2.com"  // Backblaze endpoint for your bucket
    }
    region     = "us-west-002"                // Backblaze region name
    bucket     = "bucket-name"                // Your bucket name
    key        = "path/to/terraform.tfstate"  // Path to store your state file
    access_key = ""                           // Leave blank for CLI input
    secret_key = ""                           // Leave blank for CLI input
  }
}
```

The `skip_` settings are required because Backblaze doesn’t support some AWS-specific features like regions and metadata APIs.

---

2. **Initialize the Backend**

Once your configuration is ready, initialize it with the following command:

```sh
tofu init \
  -backend-config="access_key=xxxxxxx" \
  -backend-config="secret_key=yyyyyyy"
```

The flags:
- `access_key`: Your Backblaze application key ID.
- `secret_key`: Your Backblaze application key.

---

### What Happens Next?

Your state file is now stored in Backblaze B2. Continue using OpenTofu as usual.

---

### What is OpenTofu?

**OpenTofu** is an open-source alternative to HashiCorp's Terraform, born after HashiCorp switched Terraform's licensing model from open-source to the more restrictive Business Source License (BSL). OpenTofu is a community-driven fork of Terraform, so that infrastructure-as-code (IaC) tools stay open.

#### Why OpenTofu matters
1. **True Open-Source:** Maintains an open license.
2. **Continuity:** A drop-in replacement for Terraform users, working with existing configurations.
3. **Community-Driven:** Built and governed by a community of developers.
4. **Future-Proof:** Protects IaC tools from sudden licensing changes.

OpenTofu is a fork that keeps the license open.
