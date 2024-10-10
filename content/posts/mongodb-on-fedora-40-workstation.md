---
title: "Installing MongoDB 7 on Fedora 40 Workstation"
params:
  author: 'widnyana'
date: "2024-06-16"
description: "A note about installing MongoDB 7.0 on Fedora 40 Workstation"
tags:
 - fedora
 - mongodb
 - database
 - nosql
 - linux
cover:
  image: "https://images.unsplash.com/photo-1658204238967-3a81a063d162?q=80&w=2062&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
---

I'm in the need to install `mongosh` on my Fedora Linux 40 Workstation, as a context the MongoDB server is using version 7.x running in container using `docker-compose.yaml` on docker version `26.1.4`.

<!--more-->
---

## Running the MongoDB Server

I'm using this configuration to run the server:

```yaml
name: self-hosted

networks:
  self-hosted:
    driver: bridge

services:
  mongo7:
    image: bitnami/mongodb:7.0
    platform: linux/amd64
    container_name: mongo7
    restart: no
    ports:
      - 27017:27017
    networks:
      - self-hosted
    volumes:
      - mongo7_data:/data
    env_file: 
      - path: ./env.mongodb
        required: true
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh mongodb://${MONGODB_ROOT_USER}:${MONGODB_ROOT_PASSWORD}@localhost:27017/?authSource=${MONGODB_DATABASE} --quiet
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 40s
```

with following env file:

```shell
# file: ./env.mongodb

MONGODB_ADVERTISED_HOSTNAME=rx-0
MONGODB_ROOT_USER=root
MONGODB_ROOT_PASSWORD=root
MONGODB_USERNAME=mongo
MONGODB_PASSWORD=mongo
MONGODB_DATABASE=selfhost
MONGODB_METRICS_USERNAME=collector
MONGODB_METRICS_PASSWORD=collectme


```
<br>

---

## Connecting to MongoDB as client using mongosh


By default, MongoDB does not provide a repository for Fedora, they only have for RHEL / CentOS Stream / Oracle / Rocky / AlmaLinux. And since Fedora 40 is the latest version, we can use official MongoDB repository for redhat-9.

Create new file on `/etc/yum.repos.d/mongodb-org-7.0.repo` with following contents:

```ini
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/9Server/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-7.0.asc
```

Then you can search for `mongosh` to get name of the package to install

```shell

root@localhost:~# dnf search mongosh
Last metadata expiration check: -1 day, 17:39:10 ago on Sun 16 Jun 2024 09:15:26 PM WIB.
=========================================================================================================== Name Matched: mongosh ============================================================================================================
mongodb-mongosh.x86_64 : MongoDB Shell CLI REPL Package
mongodb-mongosh-shared-openssl11.x86_64 : MongoDB Shell CLI REPL Package
mongodb-mongosh-shared-openssl3.x86_64 : MongoDB Shell CLI REPL Package
```

On Fedora 40, you need to install `mongodb-mongosh-shared-openssl3` package:

```shell
root@localhost:~# sudo dnf install mongodb-mongosh-shared-openssl3
Last metadata expiration check: -1 day, 17:55:42 ago on Sun 16 Jun 2024 09:15:26 PM WIB.
Dependencies resolved.
================================================================================================================================================================================================================================================
 Package                                                                  Architecture                                    Version                                                Repository                                                Size
================================================================================================================================================================================================================================================
Installing:
 mongodb-mongosh-shared-openssl3                                          x86_64                                          2.2.9-1.el8                                            mongodb-org-7.0                                           54 M

Transaction Summary
================================================================================================================================================================================================================================================
Install  1 Package

Total size: 54 M
Installed size: 243 M
Is this ok [y/N]: y   // press 'y' follow by 'enter'    
```

DO NOT install the `mongodb-mongosh` package, or you will get this following error when invoking the command:

```shell
user@localhost:~$ mongosh 'mongodb://localhost:27017/?authSource=selfhost'
mongosh: OpenSSL configuration error:
40083F65B27F0000:error:030000A9:digital envelope routines:alg_module_init:unknown option:../deps/openssl/openssl/crypto/evp/evp_cnf.c:61:name=rh-allow-sha1-signatures, value=yes

```
