#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import 'source-map-support/register';
import { PipelineStack } from '../lib/pipeline';

const app = new cdk.App();

new PipelineStack(app, 'pipelineStack', {
  env: {
    account: app.node.tryGetContext('cicdAccount'),
    region: 'eu-west-1'
  }
}, {
  testAccount: app.node.tryGetContext('testAccount'),
  prodAccount: app.node.tryGetContext('prodAccount'),
  parentDomain: app.node.tryGetContext('parentDomain'),
});
