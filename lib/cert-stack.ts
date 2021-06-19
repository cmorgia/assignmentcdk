import { Certificate, CertificateValidation } from "@aws-cdk/aws-certificatemanager";
import { PublicHostedZone } from "@aws-cdk/aws-route53";
import { StringParameter } from "@aws-cdk/aws-ssm";
import { Construct, Stack, StackProps } from "@aws-cdk/core";

export class CertStack extends Stack {
    constructor(scope: Construct, id: string, subdomain: string, props?: StackProps) {
        super(scope, id, props);

        const publicZone = PublicHostedZone.fromLookup(this, 'publicHostedZone', { domainName: 'testlabmorgia.co.uk' });
        const certificate = new Certificate(this, 'Certificate', {
            domainName: `www.${subdomain}.testlabmorgia.co.uk`,
            validation: CertificateValidation.fromDns(publicZone)
        });

        new StringParameter(this, 'certParameter', {
            allowedPattern: '.*',
            description: `The certificate ARN for subdomain ${subdomain}`,
            parameterName: `${subdomain}Certificate`,
            stringValue: certificate.certificateArn
        });
    }
}