#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import 'source-map-support/register';
import { PipelineStack } from '../lib/pipeline';

const app = new cdk.App();
const mainRegion = app.node.tryGetContext('mainRegion');
const failoverRegion = app.node.tryGetContext('failoverRegion');

[mainRegion, failoverRegion].forEach( region => 
  new PipelineStack(app, 'pipelineStack', {
    env: {
      account: app.node.tryGetContext('cicdAccount'),
      region: region
    }
  }, {
    testAccount: app.node.tryGetContext('testAccount'),
    prodAccount: app.node.tryGetContext('prodAccount'),
    parentDomain: app.node.tryGetContext('parentDomain')
  })
);
