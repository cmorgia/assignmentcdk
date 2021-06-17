import { AutoScalingGroup, Signals } from '@aws-cdk/aws-autoscaling';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { AllowedMethods, Distribution, SecurityPolicyProtocol, SSLMethod, ViewerCertificate, ViewerProtocolPolicy } from '@aws-cdk/aws-cloudfront';
import { LoadBalancerV2Origin, S3Origin } from '@aws-cdk/aws-cloudfront-origins';
import { AmazonLinuxImage, CloudFormationInit, InitCommand, InitConfig, InitFile, InitGroup, InitPackage, InitService, InstanceClass, InstanceSize, InstanceType, Port, SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, TargetType } from '@aws-cdk/aws-elasticloadbalancingv2';
import { DatabaseClusterEngine, ParameterGroup, ServerlessCluster } from '@aws-cdk/aws-rds';
import { Bucket } from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { Duration } from '@aws-cdk/core';

export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'vpc', {
      cidr: '10.0.0.0/24',
      maxAzs: 3,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC },
        { name: 'private', subnetType: SubnetType.PRIVATE }
      ]
    });

    const alb = new ApplicationLoadBalancer(this, 'alb', {
      vpc: vpc,
      internetFacing: true
    });

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
            InitFile.fromAsset('/var/www/html/demo.html','lib/demo.html'),
            InitFile.fromAsset('/tmp/perms.sh','lib/perms.sh'),
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

    const staticFiles = new Bucket(this,'staticFiles',{
      websiteIndexDocument: 'demo.html'
    });

    const certificate = new Certificate(this, 'Certificate', {
      domainName: 'example.com',
      subjectAlternativeNames: ['*.example.com'],
    });

    const myWebDistribution = new Distribution(this, 'myDist', {
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(alb),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        'static/*': {
          origin: new S3Origin(staticFiles),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        }
      },
      certificate: certificate,
      domainNames: ['example.com', 'www.example.com']
    });

    const cluster = new ServerlessCluster(this, 'auroraServerless', {
      engine: DatabaseClusterEngine.AURORA_POSTGRESQL,
      parameterGroup: ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
      vpc: vpc
    });
  }

}
