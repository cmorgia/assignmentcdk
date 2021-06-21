#!/bin/sh
export CICD_ACCOUNT_ID=$(jq -r .context.cicdAccount <cdk.json)
export TEST_ACCOUNT_ID=$(jq -r .context.testAccount <cdk.json)
export PROD_ACCOUNT_ID=$(jq -r .context.prodAccount <cdk.json)

export CICD_PROFILE=cicd
export TEST_PROFILE=test
export PROD_PROFILE=prod

export REGION=eu-west-1
export CLOUDFRONT_REGION=us-east-1

# bootstrap for CDK pipeline only, main region
cdk bootstrap --profile $CICD_PROFILE --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $CICD_ACCOUNT_ID aws://$CICD_ACCOUNT_ID/$REGION

# bootstrap test environment for CloudFormation (main region) and CloudFront (North Virginia)
cdk bootstrap --profile $TEST_PROFILE --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $CICD_ACCOUNT_ID aws://$TEST_ACCOUNT_ID/$REGION
cdk bootstrap --profile $TEST_PROFILE --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $CICD_ACCOUNT_ID aws://$TEST_ACCOUNT_ID/$CLOUDFRONT_REGION

# bootstrap prod environment for CloudFormation (main region) and CloudFront (North Virginia)
cdk bootstrap --profile $PROD_PROFILE --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $CICD_ACCOUNT_ID aws://$PROD_ACCOUNT_ID/$REGION
cdk bootstrap --profile $PROD_PROFILE --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $CICD_ACCOUNT_ID aws://$PROD_ACCOUNT_ID/$CLOUDFRONT_REGION

# create all the required resources
cdk --profile $CICD_PROFILE deploy --app "npx ts-node bin/required-resources.ts"  --all

# deploy the main pipeline
cdk --profile $CICD_PROFILE deploy pipelineStack