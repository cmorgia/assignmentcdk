import { Repository } from "@aws-cdk/aws-codecommit";
import { Artifact } from "@aws-cdk/aws-codepipeline";
import { CodeCommitSourceAction } from '@aws-cdk/aws-codepipeline-actions';
import { Effect, PolicyStatement } from "@aws-cdk/aws-iam";
import { CfnOutput, Construct, Stack, Stage, StageProps } from "@aws-cdk/core";
import { CdkPipeline, SimpleSynthAction } from "@aws-cdk/pipelines";
import { CdkStack } from "./cdk-stack";
import { CertStack } from "./cert-stack";

class MyStage extends Stage {
    constructor(scope: Construct, id: string, subdomain:string, parentDomain:string, props?: StageProps) {
        super(scope, id, props);
        const stack = new CdkStack(this, 'mainStack', subdomain,parentDomain);
    }
}

export interface PipelineStackProps {
    testAccount: string;
    prodAccount: string;
    parentDomain: string;
};

export class PipelineStack extends Stack {
    constructor(scope: Construct, id: string, props: StageProps, config:PipelineStackProps) {
        super(scope, id, props);

        // Create CodePipeline artifact to hold source code from repo
        const sourceArtifact = new Artifact();
        // Create CodePipeline artifact to hold synthesized cloud assembly
        const cloudAssemblyArtifact = new Artifact();

        const repo = new Repository(this, 'repo', { repositoryName: 'assignmentRepo' });

        // Create the CDK pipeline
        const pipeline = new CdkPipeline(this, 'pipeline', {
            pipelineName: 'cdkPipeline',
            cloudAssemblyArtifact: cloudAssemblyArtifact,

            // Checkout source from GitHub
            sourceAction: new CodeCommitSourceAction({
                actionName: 'CodeCommit',
                output: sourceArtifact,
                repository: repo
            }),
            // For synthesize we use the default NPM synth
            synthAction: SimpleSynthAction.standardNpmSynth({
                sourceArtifact,
                cloudAssemblyArtifact,
                installCommand: 'npm i -g npm && npm install cdk-assume-role-credential-plugin && npm ci',
                rolePolicyStatements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: [
                        "sts:AssumeRole",
                      ],
                      resources: [
                        "arn:aws:iam::*:role/cdk-readOnlyRole"
                      ]
                    })
                  ]
            })
        });

        const testStage = pipeline.addApplicationStage(new MyStage(this, 'testStage', 'test', config.parentDomain, { env: { account: config.testAccount, region: Stack.of(this).region } }));
        testStage.addManualApprovalAction({actionName:'approveToProduction'});
        pipeline.addApplicationStage(new MyStage(this, 'prodStage', 'prod', config.parentDomain, { env: { account: config.prodAccount, region: Stack.of(this).region } }));


        new CfnOutput(this, 'repositoryHttp', {
            value: repo.repositoryCloneUrlHttp,
            description: 'CodeCommit repository URL', 
            exportName: 'repositoryHttp'
        });
    }
}