terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State is local for now. Once an S3 bucket + DynamoDB lock table exist,
  # migrate with `terraform init -migrate-state` and uncomment:
  #
  # backend "s3" {
  #   bucket         = "autoclaw-terraform-state"
  #   key            = "autoclaw-web/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "autoclaw-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
