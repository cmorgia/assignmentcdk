import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { RequiredResourcesStack } from '../lib/required-resources';
import { CertStack } from '../lib/cert-stack';

const app = new cdk.App();

const mainRegion = app.node.tryGetContext('mainRegion');
const failoverRegion = app.node.tryGetContext('failoverRegion');
const trustedAccount = app.node.tryGetContext('cicdAccount');
const parentZone = app.node.tryGetContext('parentDomain');
const cloudFrontCertificateRegion = 'us-east-1';

[mainRegion, failoverRegion].forEach( region => 
  new RequiredResourcesStack(app, 'test', {
    env: { account: app.node.tryGetContext('testAccount'), region: region },
    trustedAccount
  })
);

new CertStack(app, 'testCert', {
  subdomain: 'test',
  delegationAccount: app.node.tryGetContext('prodAccount'),
  parentZone: parentZone
}, {
  env: {
    account: app.node.tryGetContext('testAccount'),
    region: cloudFrontCertificateRegion
  }
});

[mainRegion, failoverRegion].forEach( region => 
  new RequiredResourcesStack(app, 'prod', {
    env: { account: app.node.tryGetContext('prodAccount'), region: region },
    trustedAccount
  })
);

new CertStack(app, 'prodCert', {
  subdomain: 'prod',
  delegationAccount: app.node.tryGetContext('testAccount'),
  parentZone: parentZone
}, {
  env: {
    account: app.node.tryGetContext('prodAccount'),
    region: cloudFrontCertificateRegion
  }
});
