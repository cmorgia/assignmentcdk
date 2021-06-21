import { AutoScalingGroup, Signals } from '@aws-cdk/aws-autoscaling';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { Distribution, OriginProtocolPolicy, ViewerProtocolPolicy } from '@aws-cdk/aws-cloudfront';
import { LoadBalancerV2Origin, S3Origin } from '@aws-cdk/aws-cloudfront-origins';
import { AmazonLinuxImage, CloudFormationInit, InitCommand, InitConfig, InitFile, InitGroup, InitPackage, InitService, InstanceClass, InstanceSize, InstanceType, InterfaceVpcEndpointAwsService, Peer, Port, SecurityGroup, SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { FileSystem } from '@aws-cdk/aws-efs';
import { CfnReplicationGroup, CfnSubnetGroup } from '@aws-cdk/aws-elasticache';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, TargetType } from '@aws-cdk/aws-elasticloadbalancingv2';
import { DatabaseClusterEngine, ParameterGroup, ServerlessCluster } from '@aws-cdk/aws-rds';
import { ARecord, PublicHostedZone, RecordTarget } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import { Bucket } from '@aws-cdk/aws-s3';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import * as cdk from '@aws-cdk/core';
import { CfnOutput, Duration, Stack } from '@aws-cdk/core';
import { ParameterReader } from '@henrist/cdk-cross-region-params';

export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, subdomain: string, parentDomain:string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'vpc', {
      cidr: '10.0.0.0/24',
      maxAzs: 3,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC },
        { name: 'private', subnetType: SubnetType.PRIVATE }
      ]
    });

    const ec2SG = new SecurityGroup(this,'ec2SG',{ vpc: vpc });

    ec2SG.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock),Port.tcp(80));

    const fs = new FileSystem(this,'efsShared',{
      vpc: vpc,
      vpcSubnets: { subnetGroupName: 'private'}
    });

    fs.connections.allowDefaultPortFrom(ec2SG);
    fs.addAccessPoint('ec2AccessPoint');

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
      desiredCapacity: 0,
      maxInstanceLifetime: Duration.days(10),
      spotPrice: '0.5',
      init: CloudFormationInit.fromConfigSets({
        configSets: {
          default: ['yumPreinstall', 'config'],
        },
        configs: {
          yumPreinstall: new InitConfig([
            InitPackage.yum('httpd24'),
            InitPackage.yum('amazon-efs-utils'),
            InitPackage.yum('nfs-utils'),
          ]),
          config: new InitConfig([
            InitFile.fromAsset('/var/www/html/demo.html', 'site/dynamic/demo.html'),
            InitFile.fromAsset('/tmp/perms.sh', 'lib/perms.sh', { mode: '000777' }),
            InitGroup.fromName('www'),
            InitService.enable('httpd'),
            InitCommand.shellCommand('sh -c /tmp/perms.sh'),
            InitCommand.shellCommand("file_system_id_1=" + fs.fileSystemId),
            InitCommand.shellCommand("mkdir -p /mnt/efs/fs1"),
            InitCommand.shellCommand(`test -f /sbin/mount.efs && echo ${fs.fileSystemId}:/ /mnt/efs/fs1 efs defaults,_netdev >> /etc/fstab || ` +
            `echo \"${fs.fileSystemId}.efs.${Stack.of(this).region}.amazonaws.com:/ /mnt/efs/fs1 nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0\" >> /etc/fstab`),
            InitCommand.shellCommand("mount -a -t efs,nfs4 defaults")
          ]),
        }
      }),
      signals: Signals.waitForAll({
        timeout: Duration.minutes(10),
      }),
      securityGroup: ec2SG
    });

    asg.attachToApplicationTargetGroup(tg);

    asg.connections.allowFrom(alb, Port.tcp(80));
    asg.scaleOnCpuUtilization('cpuScale', { targetUtilizationPercent: 50 });

    const cluster = new ServerlessCluster(this, 'auroraServerless', {
      engine: DatabaseClusterEngine.AURORA_POSTGRESQL,
      parameterGroup: ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
      vpc: vpc
    });

    const staticFiles = new Bucket(this, 'staticFiles');

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
      domainNames: [`www.${subdomain}.${parentDomain}`],
      enableLogging: true
    });

    new ARecord(this, 'aliasCF', {
      recordName: 'www',
      zone: PublicHostedZone.fromLookup(this, 'publicHostedZone', { domainName: `${subdomain}.${parentDomain}` }),
      target: RecordTarget.fromAlias(new CloudFrontTarget(myWebDistribution))
    });

    new CfnOutput(this, 'distribution static demo', {
      value: `https://www.${subdomain}.${parentDomain}/static/demo.html`,
      description: 'Static demo page'
    });

    new CfnOutput(this, 'distribution dynamic demo', {
      value: `https://www.${subdomain}.${parentDomain}/demo.html`,
      description: 'Dynamic demo page'
    });

    new BucketDeployment(this, 'bucketDeployment', {
      destinationBucket: staticFiles,
      destinationKeyPrefix:'static',
      sources: [Source.asset('./site/static')],
      distribution: myWebDistribution,
      distributionPaths: ['/static/*']
    });

    const subnetGroup = new CfnSubnetGroup(this, 'redisSubnetGroup', {
      cacheSubnetGroupName: 'redisSubnetGroup',
      subnetIds: vpc.selectSubnets({ subnetGroupName: 'private' }).subnetIds,
      description: 'SubnetGroup for Redis Cluster'
    });
    const secGroup = new SecurityGroup(this, 'redisSecGroup', { vpc: vpc });
    secGroup.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(6379));

    const redisReplGroup = new CfnReplicationGroup(this, 'redis', {
        replicationGroupDescription: 'Redis Replication Group',
        cacheNodeType: 'cache.t3.micro',
        cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
        multiAzEnabled: true,
        numCacheClusters: 2,
        automaticFailoverEnabled: true,
        engine: 'redis',
        port: 6379,
        securityGroupIds: [secGroup.securityGroupId],
        snapshotRetentionLimit: 7
    });
    redisReplGroup._addResourceDependency(subnetGroup);

    new CfnOutput(this, 'redisEndpoint', {
      value: `redis://${redisReplGroup.attrPrimaryEndPointAddress}:${redisReplGroup.attrPrimaryEndPointPort}`,
      description: 'Redis endpoint'
    });
  }
}
