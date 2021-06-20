import { AutoScalingGroup, Signals } from '@aws-cdk/aws-autoscaling';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { Distribution, OriginProtocolPolicy, ViewerProtocolPolicy } from '@aws-cdk/aws-cloudfront';
import { LoadBalancerV2Origin, S3Origin } from '@aws-cdk/aws-cloudfront-origins';
import { AmazonLinuxImage, CloudFormationInit, InitCommand, InitConfig, InitFile, InitGroup, InitPackage, InitService, InstanceClass, InstanceSize, InstanceType, InterfaceVpcEndpointAwsService, Peer, Port, SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, TargetType } from '@aws-cdk/aws-elasticloadbalancingv2';
import { DatabaseClusterEngine, ParameterGroup, ServerlessCluster } from '@aws-cdk/aws-rds';
import { ARecord, PublicHostedZone, RecordTarget } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import { Bucket } from '@aws-cdk/aws-s3';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import * as cdk from '@aws-cdk/core';
import { Duration } from '@aws-cdk/core';
import { ParameterReader } from '@henrist/cdk-cross-region-params';

export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, subdomain: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'vpc', {
      cidr: '10.0.0.0/24',
      maxAzs: 3,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC },
        { name: 'private', subnetType: SubnetType.PRIVATE }
      ]
    });

    Object.entries({ 'ssm':InterfaceVpcEndpointAwsService.SSM, 'ssmMessages':InterfaceVpcEndpointAwsService.SSM_MESSAGES, 'ec2Messages':InterfaceVpcEndpointAwsService.EC2_MESSAGES}).forEach(entry => { 
      const endpoint = vpc.addInterfaceEndpoint(`${entry[0]}ssmEndpoint`, {
        service: entry[1],
        privateDnsEnabled: true,
        subnets: { subnetGroupName: 'private' }
      });
      endpoint.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock),Port.tcp(443));
    });

    const albLogs = new Bucket(this,'albLogs');

    const alb = new ApplicationLoadBalancer(this, 'alb', {
      vpc: vpc,
      internetFacing: true
    });
    alb.logAccessLogs(albLogs);

    const tg = new ApplicationTargetGroup(this, 'tg', {
      protocol: ApplicationProtocol.HTTP,
      vpc: vpc,
      targetType: TargetType.INSTANCE
    });

    alb.addListener('albListener', { defaultTargetGroups: [tg], protocol: ApplicationProtocol.HTTP });

    const asg = new AutoScalingGroup(this, 'asg', {
      vpc: vpc,
      instanceType: InstanceType.of(InstanceClass.BURSTABLE3, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage(),
      maxCapacity: 8,
      minCapacity: 0,
      desiredCapacity: 1,
      maxInstanceLifetime: Duration.days(10),
      spotPrice: '0.5',
      init: CloudFormationInit.fromConfigSets({
        configSets: {
          default: ['yumPreinstall', 'config'],
        },
        configs: {
          yumPreinstall: new InitConfig([
            InitPackage.yum('httpd24'),
          ]),
          config: new InitConfig([
            InitFile.fromAsset('/var/www/html/demo.html', 'site/demo.html'),
            InitFile.fromAsset('/tmp/perms.sh', 'lib/perms.sh', { mode: '000777' }),
            InitGroup.fromName('www'),
            InitService.enable('httpd'),
            InitCommand.shellCommand('sh -c /tmp/perms.sh')
          ]),
        },
      }),
      signals: Signals.waitForAll({
        timeout: Duration.minutes(10),
      })
    });

    asg.attachToApplicationTargetGroup(tg);

    asg.connections.allowFrom(alb, Port.tcp(80));
    asg.scaleOnCpuUtilization('cpuScale', { targetUtilizationPercent: 50 });

    const staticFiles = new Bucket(this, 'staticFiles');

    const cluster = new ServerlessCluster(this, 'auroraServerless', {
      engine: DatabaseClusterEngine.AURORA_POSTGRESQL,
      parameterGroup: ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
      vpc: vpc
    });

    const certificateArn = new ParameterReader(this, 'certParam', {
      region: 'us-east-1',
      parameterName: `${subdomain}Certificate`
    }).parameterValue;

    const certificate = Certificate.fromCertificateArn(this, 'certificate', certificateArn);

    const myWebDistribution = new Distribution(this, 'myDist', {
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(alb, {protocolPolicy: OriginProtocolPolicy.HTTP_ONLY}),
        //viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        'static/*': {
          origin: new S3Origin(staticFiles),
          //viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        }
      },
      certificate: certificate,
      domainNames: [`www.${subdomain}.testlabmorgia.co.uk`],
      enableLogging: true
    });

    new ARecord(this, 'aliasCF', {
      recordName: 'www',
      zone: PublicHostedZone.fromLookup(this, 'publicHostedZone', { domainName: `${subdomain}.testlabmorgia.co.uk` }),
      target: RecordTarget.fromAlias(new CloudFrontTarget(myWebDistribution))
    });

    new BucketDeployment(this, 'bucketDeployment', {
      destinationBucket: staticFiles,
      sources: [Source.asset('./site')],
      distribution: myWebDistribution,
      distributionPaths: ['/static/*']
    });
  }

}
