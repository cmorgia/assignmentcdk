# AWS EMEA Solutions Architect Hiring Assignment

This repository is a proof-of-concept implementation of the proposed solution (short term) design for the assignment.

![Short term architecture](ShortTerm.png "Short term architecture")
It includes the new Application Load Balancer with autoscaling group and scaling policy.

It also implements the static file serving separatation through CloudFront and an S3 bucket, including cross-region deployment of digital certificates for CloudFront.

The CDK pipeline implements cross-account deployment with automated roles creation and assume, using a plugin.
