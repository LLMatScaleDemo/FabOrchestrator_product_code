output "application_name" {
  value = aws_elastic_beanstalk_application.this.name
}

output "environment_name" {
  value = aws_elastic_beanstalk_environment.this.name
}

output "environment_id" {
  value = aws_elastic_beanstalk_environment.this.id
}

output "cname" {
  description = "The environment's public CNAME."
  value       = aws_elastic_beanstalk_environment.this.cname
}

output "endpoint_url" {
  value = aws_elastic_beanstalk_environment.this.endpoint_url
}

output "load_balancers" {
  value = aws_elastic_beanstalk_environment.this.load_balancers
}

output "build_bucket" {
  value = var.create_build_bucket ? aws_s3_bucket.build[0].bucket : null
}
