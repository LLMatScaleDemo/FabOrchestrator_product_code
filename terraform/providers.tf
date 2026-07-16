provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "FabOrchestrator"
      ManagedBy = "Terraform"
    }
  }
}
