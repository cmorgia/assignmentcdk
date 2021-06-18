import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { RequiredResourcesStack } from '../lib/required-resources';

const app = new cdk.App();

const test = { account: app.node.tryGetContext('testAccount'), region: 'eu-west-1' }
const prod = { account: app.node.tryGetContext('prodAccount'), region: 'eu-west-1' }
const trustedAccount = app.node.tryGetContext('cicdAccount');

new RequiredResourcesStack(app, 'test', {
  env: test,
  trustedAccount
});

new RequiredResourcesStack(app, 'prod', {
  env: prod,
  trustedAccount
});