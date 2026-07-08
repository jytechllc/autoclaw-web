output "vpc_id" {
  description = "ID of the VPC — needed by P3's ALB/ECS/RDS resources and by P1 for ECS service networking"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  value = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs — ALB goes here"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs — ECS Fargate tasks and RDS go here"
  value       = aws_subnet.private[*].id
}

output "nat_gateway_ids" {
  value = aws_nat_gateway.main[*].id
}

output "availability_zones" {
  value = var.availability_zones
}
