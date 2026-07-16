# Remote state in S3 with a DynamoDB lock table.
#
# Bootstrap once (outside Terraform, or in a separate state) before `init`:
#   aws s3api create-bucket --bucket faborchestratorai-tfstate-628203515088 \
#     --region us-west-2 --create-bucket-configuration LocationConstraint=us-west-2
#   aws s3api put-bucket-versioning --bucket faborchestratorai-tfstate-628203515088 \
#     --versioning-configuration Status=Enabled
#   aws dynamodb create-table --table-name faborchestratorai-tflock \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST --region us-west-2
#
# Then run: terraform init
terraform {
  backend "s3" {
    bucket         = "faborchestratorai-tfstate-628203515088"
    key            = "faborchestrator/prod/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "faborchestratorai-tflock"
    encrypt        = true
  }
}
