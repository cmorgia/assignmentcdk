import { Certificate, CertificateValidation } from "@aws-cdk/aws-certificatemanager";
import { AccountPrincipal, PolicyDocument, PolicyStatement, Role } from "@aws-cdk/aws-iam";
import { CrossAccountZoneDelegationRecord, PublicHostedZone, PublicHostedZoneProps, ZoneDelegationRecord } from "@aws-cdk/aws-route53";
import { StringParameter } from "@aws-cdk/aws-ssm";
import { Construct, Stack, StackProps } from "@aws-cdk/core";

export interface CertStackProps {
    readonly subdomain: string;
    readonly delegationAccount: string;
    readonly parentZone: string;
}
export class CertStack extends Stack {
    constructor(scope: Construct, id: string, config:CertStackProps, props: StackProps) {
        super(scope, id, props);

        var publicZone;
        if (config.subdomain == 'test') {

            const parentZone = PublicHostedZone.fromLookup(this, 'publicHostedZone', { domainName: config.parentZone });
            new Role(this, 'CrossAccountZoneDelegationRole', {
                roleName: 'ZoneDelegationRole',
                assumedBy: new AccountPrincipal(config.delegationAccount),
                inlinePolicies: {
                    delegation: new PolicyDocument({
                        statements: [
                            new PolicyStatement({
                                actions: ['route53:ChangeResourceRecordSets'],
                                resources: [parentZone.hostedZoneArn],
                            }),
                            new PolicyStatement({
                                actions: ['route53:ListHostedZonesByName'],
                                resources: ['*'],
                            }),
                        ],
                    }),
                },
            });

            publicZone = new PublicHostedZone(this, `${config.subdomain}HostedZone`, {
                zoneName: `${config.subdomain}.${config.parentZone}`
            });

            new ZoneDelegationRecord(this,'delegate',{
                zone: parentZone,
                recordName: config.subdomain,
                nameServers: publicZone.hostedZoneNameServers || []
            });

        } else {
            publicZone = new PublicHostedZone(this, `${config.subdomain}HostedZone`, {
                zoneName: `${config.subdomain}.${config.parentZone}`
            });

            const delegationRoleArn = Stack.of(this).formatArn({
                region: '', // IAM is global in each partition
                service: 'iam',
                account: config.delegationAccount,
                resource: 'role',
                resourceName: 'ZoneDelegationRole',
            });
            const delegationRole = Role.fromRoleArn(this, 'DelegationRole', delegationRoleArn);

            // create the record
            new CrossAccountZoneDelegationRecord(this, 'delegate', {
                delegatedZone: publicZone,
                parentHostedZoneName: config.parentZone,
                delegationRole,
            });
        }

        const certificate = new Certificate(this, 'Certificate', {
            domainName: `www.${config.subdomain}.${config.parentZone}`,
            validation: CertificateValidation.fromDns(publicZone)
        });

        new StringParameter(this, 'certParameter', {
            allowedPattern: '.*',
            description: `The certificate ARN for subdomain ${config.subdomain}`,
            parameterName: `${config.subdomain}Certificate`,
            stringValue: certificate.certificateArn
        });
    }
}