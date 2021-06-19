import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { RequiredResourcesStack } from '../lib/required-resources';
import { CertStack } from '../lib/cert-stack';

const app = new cdk.App();

const test = { account: app.node.tryGetContext('testAccount'), region: 'eu-west-1' }
const prod = { account: app.node.tryGetContext('prodAccount'), region: 'eu-west-1' }
const trustedAccount = app.node.tryGetContext('cicdAccount');

new CertStack(app, 'testCert', {
  subdomain: 'test',
  delegationAccount: app.node.tryGetContext('prodAccount'),
  parentZone: 'testlabmorgia.co.uk'
}, {
  env: {
    account: app.node.tryGetContext('testAccount'),
    region: 'us-east-1'
  }
});

new RequiredResourcesStack(app, 'test', {
  env: test,
  trustedAccount
});

new CertStack(app, 'prodCert', {
  subdomain: 'prod',
  delegationAccount: app.node.tryGetContext('testAccount'),
  parentZone: 'testlabmorgia.co.uk'
}, {
  env: {
    account: app.node.tryGetContext('prodAccount'),
    region: 'us-east-1'
  }
});

new RequiredResourcesStack(app, 'prod', {
  env: prod,
  trustedAccount
});