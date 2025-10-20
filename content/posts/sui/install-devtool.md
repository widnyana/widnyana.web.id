---
title: 'Install Sui Devtool'
date: 2025-10-20T21:20:30+07:00
description: "Learn how to setup and prepare Sui blockchain development tools."
params:
  author: 'widnyana'
cover:
  image: '/images/sui-dev.jpg'
  alt: "sui-devtools"
  relative: true
  responsiveImages: true
tags: ["sui", "move", "blockchain", "web3", "devtools"]
categories: ["sui", "blockchain"]
--- 

### 1. Introduction

Sui is a Layer-1 blockchain that uses an [object-centric model](https://docs.sui.io/concepts/object-model) to process transactions in parallel, enabling high throughput and instant finality while providing native primitives for building decentralized applications.

Developers choose Sui for several compelling reasons:

* **Parallel execution** - Transactions don't wait in a single-file line, resulting in faster confirmation times
* **Consumer-ready features** - [zkLogin](https://sui.io/zklogin) (sign in with Google/Apple) and [zkSend](https://www.mystenlabs.com/blog/zksend) (share crypto via link) lower barriers to entry
* **Move programming language** - A secure, resource-oriented language designed specifically for blockchain development
* **Built for scale** - Optimized for data-heavy applications like gaming, NFTs, DeFi, and social apps

This guide walks you through setting up the complete Sui development environment on your local machine. By the end, you'll have the Sui CLI installed, a local network running, and the essential developer tools configured to start building Move smart contracts and decentralized applications on Sui.

---

### 2. Prerequisites

Before installing Sui development tools, ensure your system meets the following requirements:


| OS      | Architecture    | Status                                    |
| ------- | --------------- | ----------------------------------------- |
| Linux   | x86_64 (amd64)  | ✅ Supported                               |
| Linux   | aarch64 (ARM64) | ✅ Supported                               |
| macOS   | x86_64 (amd64)  | ✅ Supported                               |
| macOS   | aarch64 (ARM64) | ✅ Supported                               |
| Windows | x86_64 (amd64)  | ✅ Supported                               |
| Windows | aarch64 (ARM64) | Limited support (might or might not work) |

**Operating System:**
* macOS (Intel or Apple Silicon)
* Linux (Ubuntu 20.04+ or similar)
* Windows 10/11 (with WSL2 recommended)

**Required Software:**
* **Rust toolchain** (latest stable) - Required if building from source
* **Git** - For cloning repositories and version control
* **Curl or Wget** - For downloading installation scripts

**Optional but Recommended:**
* **Docker** - For containerized development environment
* **Visual Studio Code** - For Move language support and syntax highlighting
* **Node.js** (v16+) - For building dApps and frontends

**System Resources:**
* Minimum 4GB RAM (8GB+ recommended)
* At least 10GB free disk space
* Stable internet connection for downloading dependencies

If you plan to build from source using Cargo, make sure your Rust installation is up to date:

```bash
rustup update stable
```

---

### 3. Installing Sui CLI

The Sui CLI provides everything you need to develop, test, and deploy Move smart contracts. Choose the installation method that best fits your workflow.

#### Option 1: Using suiup (Recommended)

The easiest way to install and manage Sui binaries is through `suiup`, which handles version management across different networks.

```bash
# Install suiup
curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh

# Install Sui binaries
suiup install sui@testnet
```

For detailed `suiup` usage, see the [official repository](https://github.com/MystenLabs/suiup).

#### Option 2: Download Pre-built Binary

Download the latest release directly from GitHub:

1. Visit the [Sui releases page](https://github.com/MystenLabs/sui/releases)
2. Download the binary for your OS (macOS, Linux, or Windows)
3. Extract and move to your PATH
4. Make it executable: `chmod +x sui` (Unix-based systems)

#### Option 3: Package Managers

**macOS (Homebrew):**
```bash
brew install sui
```

**Windows (Chocolatey):**
```bash
choco install sui
```

#### Option 4: Build from Source (Advanced)

If you need the latest features or want to contribute, build from source using Cargo:

```bash
cargo install --git https://github.com/MystenLabs/sui.git sui --branch mainnet
```

Change `mainnet` to `testnet` or `devnet` if targeting those networks.

#### Verify Installation

Confirm Sui is installed correctly:

```bash
sui --version
```

You should see output like: `sui 1.x.x-xxxxx`

#### Initialize Sui CLI

Run the initialization command:

```bash
sui client
```

The CLI will create a `client.yaml` configuration file at `~/.sui/sui_config/client.yaml` (macOS/Linux) or `%USERPROFILE%\.sui\sui_config\client.yaml` (Windows).

When prompted:
* **Connect to Sui Full Node?** → Enter `Y` (defaults to Testnet if no URL specified)
* **Sui full node server URL** → Press Enter for Testnet, or specify:
  * `https://fullnode.testnet.sui.io:443` - Testnet (recommended for new developers)
  * `https://fullnode.devnet.sui.io:443` - Devnet (advanced use, weekly data wipes)
  * `https://fullnode.mainnet.sui.io:443` - Mainnet (requires real SUI tokens)
  * `http://0.0.0.0:9000` - Localnet (if you've set up a local network)
* **Key scheme selection** → Choose encryption scheme:
  * Press `0` for `ed25519` (recommended)
  * Press `1` for `secp256k1`
  * Press `2` for `secp256r1`

**Important**: The CLI will display a recovery phrase. Store it securely and never share it - it provides access to all objects and tokens owned by the address.

---

### 4. Managing Sui Networks

Sui supports multiple networks for different development stages. Here's how to manage and switch between them.

#### Understanding Network Options

```
| Network  | RPC URL                             | Purpose                                         |
| -------- | ----------------------------------- | ----------------------------------------------- |
| Testnet  | https://fullnode.testnet.sui.io:443 | Recommended for development, stable environment |
| Devnet   | https://fullnode.devnet.sui.io:443  | Cutting-edge features, weekly data wipes        |
| Mainnet  | https://fullnode.mainnet.sui.io:443 | Production network, requires real SUI tokens    |
| Localnet | http://0.0.0.0:9000                 | Your own local network for testing              |

```

#### Managing Networks

View all configured networks:

```bash
sui client envs
```

Switch between networks:

```bash
sui client switch --env [network-alias]
```

Example: Switch to testnet:
```bash
sui client switch --env testnet
```

Add a new custom network:

```bash
sui client new-env --alias <ALIAS> --rpc <RPC_URL>
```

Example: Add mainnet:
```bash
sui client new-env --alias mainnet --rpc https://fullnode.mainnet.sui.io:443
```

#### Check Active Address and Gas Objects

View all addresses in your keystore:

```bash
sui client addresses
```

Check the currently active address:

```bash
sui client active-address
```

List all gas objects you control:

```bash
sui client gas
```

#### Get Test Tokens

To interact with Devnet or Testnet, you'll need test tokens:

1. Join the [Sui Discord](https://discord.gg/sui)
2. Complete verification steps
3. Navigate to the faucet channel:
   * [#devnet-faucet](https://discord.com/channels/916379725201563759/971488439931392130) for Devnet tokens
   * [#testnet-faucet](https://discord.com/channels/916379725201563759/1037811694564560966) for Testnet tokens
4. Request tokens: `!faucet <YOUR_WALLET_ADDRESS>`

Alternatively, use the Sui CLI faucet command (if available):

```bash
sui client faucet
```

---

### 5. Developer Tooling

Enhance your development workflow with these essential tools and extensions.

#### Move Analyzer for VS Code

The Move Analyzer extension provides syntax highlighting, code completion, and inline error checking for Move language development.

1. Install [Visual Studio Code](https://code.visualstudio.com/)
2. Install the [Move extension](https://marketplace.visualstudio.com/items?itemName=mysten.move) from the VS Marketplace
3. Add Sui wallet address compatibility:

```bash
cargo install --git https://github.com/move-language/move-sui move-analyzer --features "address20"
```

This enables proper support for Sui's address format in the analyzer.

#### Docker Development Environment (Optional)

For a consistent, isolated development environment:

1. [Install Docker](https://docs.docker.com/get-docker/)
2. Pull the official Sui Docker image:

```bash
docker pull mysten/sui-tools:devnet
```

3. Start and access the container:

```bash
docker run --name suidevcontainer -itd mysten/sui-tools:devnet
docker exec -it suidevcontainer bash
```

**Note**: If the Docker image is incompatible with your CPU architecture, start with a base [Rust Docker image](https://hub.docker.com/_/rust) appropriate for your system and install Sui manually.

#### Essential Resources

* **Sui Explorer**: View transactions, objects, and network activity
  * Devnet: [https://devnet.suivision.xyz/](https://devnet.suivision.xyz/)
  * Testnet: [https://testnet.suivision.xyz/](https://testnet.suivision.xyz/)
  * Mainnet: [https://suivision.xyz/](https://suivision.xyz/)

* **Sui Documentation**: [https://docs.sui.io](https://docs.sui.io)
* **Move by Example**: [https://move-book.com/](https://move-book.com/)
* **Sui GitHub**: [https://github.com/MystenLabs/sui](https://github.com/MystenLabs/sui)

---

### 6. Testing and Deployment

Once your development environment is set up, you can start building and testing Move smart contracts.

#### Create a New Move Project

Initialize a new Move package:

```bash
sui move new my_first_package
cd my_first_package
```

This creates a basic project structure with:
* `Move.toml` - Package manifest
* `sources/` - Your Move source files
* `tests/` - Unit tests

#### Compile Your Move Code

Build your Move package:

```bash
sui move build
```

This compiles your code and checks for errors. The Move compiler is included in the Sui binary.

#### Run Unit Tests

Execute tests defined in your Move modules:

```bash
sui move test
```

Add the `--coverage` flag to generate coverage reports:

```bash
sui move test --coverage
```

#### Publish to Network

Deploy your package to the active network:

```bash
sui client publish --gas-budget 100000000
```

The command above will:
1. Compile your package
2. Create a publish transaction
3. Execute it on the connected network (devnet/testnet/mainnet)
4. Return the package ID for future interactions

**Important**: Make sure you have sufficient gas tokens on the active network before publishing.

#### Interact with Published Packages

Call functions from your published package:

```bash
sui client call --package <PACKAGE_ID> --module <MODULE_NAME> --function <FUNCTION_NAME> --args <ARGS> --gas-budget 10000000
```

For detailed CLI reference, see the [official Sui CLI documentation](https://docs.sui.io/build/cli-client).

---

### 7. Troubleshooting

Common issues you might encounter and how to resolve them.

#### Installation Issues

**Problem**: `sui: command not found`

**Solution**: Ensure the Sui binary is in your PATH:
```bash
# Check if sui is in PATH
which sui

# If not, add to PATH (adjust path as needed)
echo 'export PATH="$HOME/.sui/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Problem**: Rust compiler errors during `cargo install`

**Solution**: Update Rust to the latest stable version:
```bash
rustup update stable
rustc --version  # Verify Rust version
```

#### Build Errors

**Problem**: Missing dependencies or compilation failures

**Solution**:
1. Check your `Move.toml` for correct dependency declarations
2. Clean the build cache and rebuild:
```bash
sui move clean
sui move build
```

**Problem**: Module resolution errors

**Solution**: Ensure your module addresses in `Move.toml` match the package configuration:
```toml
[addresses]
my_package = "0x0"
```

#### Network Configuration Issues

**Problem**: Cannot connect to network or RPC errors

**Solution**: Verify your network configuration:
```bash
sui client envs
sui client switch --env devnet
```

**Problem**: Transaction failures due to insufficient gas

**Solution**: Request test tokens from the faucet or check your gas balance:
```bash
sui client gas
```

#### Getting Help

If you encounter issues not covered here:

1. Check the [official troubleshooting guide](https://docs.sui.io/build/install#troubleshooting)
2. Visit [Sui GitHub Issues](https://github.com/MystenLabs/sui/issues)
3. Ask in [Sui Discord](https://discord.gg/sui) support channels
4. Search [Sui Developer Forums](https://forums.sui.io)

---

### 8. Wrap-up

You've successfully set up a complete Sui development environment. Let's recap what you've accomplished:

**What You've Set Up:**
* Sui CLI installed and configured
* Network connections (Devnet, Testnet, or local)
* Development tools (Move Analyzer, optional Docker environment)
* Understanding of basic CLI commands and workflows

**Next Steps:**

1. **Build Your First Move Contract**
   * Follow the [Sui Move by Example](https://examples.sui.io) tutorials
   * Start with simple modules and gradually increase complexity
   * Experiment with Sui's unique features (object model, parallel execution)

2. **Connect to Testnet**
   * Get testnet tokens from the Discord faucet
   * Deploy a package to testnet
   * Test your contracts in a production-like environment

3. **Explore Advanced Features**
   * Learn about zkLogin for seamless user authentication
   * Experiment with zkSend for easy asset transfers
   * Build consumer-facing dApps leveraging Sui's UX primitives

4. **Join the Community**
   * [Sui Discord](https://discord.gg/sui) - Get help and connect with developers
   * [Sui Developer Forums](https://forums.sui.io) - Technical discussions
   * [Sui GitHub](https://github.com/MystenLabs/sui) - Contribute to the ecosystem

**Recommended Learning Resources:**
* [Official Sui Documentation](https://docs.sui.io)
* [Sui Move Introduction Course](https://github.com/sui-foundation/sui-move-intro-course)
* [Move Book](https://move-book.com) - Deep dive into Move language

---

Happy building on Sui!
