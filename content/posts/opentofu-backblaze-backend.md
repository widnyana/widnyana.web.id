---
title: 'Opentofu Backblaze Backend'
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

Infrastructure as Code (IaC) tools like **OpenTofu** rely on state files to keep track of the resources they manage. This state file is critical—it’s how OpenTofu knows what’s already been deployed, updated, or destroyed. If you're looking for a cost-effective, reliable, and scalable storage solution for your state files, **Backblaze B2** is an excellent choice. 

The good news? Configuring OpenTofu to use Backblaze B2 is a breeze! It’s almost identical to setting up Amazon S3 as the backend, with just a tiny tweak. Let’s walk through it.

---

### Why Choose Backblaze B2?

1. **Cost Savings:** Backblaze B2 offers cloud storage at a fraction of the cost of traditional providers.
2. **S3 Compatibility:** Fully supports the S3 API, so you can reuse familiar configurations.
3. **Performance and Reliability:** Backed by robust infrastructure for seamless operation.

If you're already comfortable with S3, you're in for an easy ride. If not, don’t worry—this guide will make you feel like a pro.

---

### The Configuration

Here’s how you can configure OpenTofu to store its state file in Backblaze B2:

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

What’s with all the `skip_` settings? They’re required because Backblaze doesn’t support some AWS-specific features like regions and metadata APIs. These skips ensure everything runs smoothly.

---

2. **Initialize the Backend**

Once your configuration is ready, initialize it with the following command:

```sh
tofu init \
  -backend-config="access_key=xxxxxxx" \
  -backend-config="secret_key=yyyyyyy"
```

Here’s what each flag does:
- `access_key`: Your Backblaze application key ID.
- `secret_key`: Your Backblaze application key.

---

### What Happens Next?

That’s it! Your state file is now stored securely in Backblaze B2. From this point, you can continue doing some magic and casting spells as usual.

So go ahead, give Backblaze B2 a try!

---

### What is OpenTofu, and Why Does It Matter?

**OpenTofu** is an open-source alternative to HashiCorp's Terraform, born after HashiCorp switched Terraform's licensing model from open-source to the more restrictive Business Source License (BSL). OpenTofu is a community-driven fork of Terraform, ensuring that infrastructure-as-code (IaC) tools remain truly open and accessible to everyone.

#### Why OpenTofu Matters:
1. **True Open-Source:** Maintains an open license, enabling collaboration and innovation without restrictions.
2. **Continuity:** Provides a drop-in replacement for Terraform users, ensuring seamless adoption with existing configurations.
3. **Community-Driven:** Built and governed by a growing community of developers, prioritizing users' needs over corporate interests.
4. **Future-Proof:** Protects IaC tools from sudden licensing changes that could disrupt workflows.

OpenTofu is more than a fork—it’s a stand for openness and trust in the infrastructure ecosystem.
