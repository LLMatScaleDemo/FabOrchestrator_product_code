# Existing shared infrastructure referenced by the config.

data "aws_vpc" "shared" {
  id = var.shared_vpc_id
}

# All route tables in the shared VPC — the peering module adds a return route to
# the app subnets on each so RDS replies can find their way back.
data "aws_route_tables" "shared" {
  vpc_id = var.shared_vpc_id
}
