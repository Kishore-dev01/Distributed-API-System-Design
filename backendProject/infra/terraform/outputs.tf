output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_id" {
  value = aws_subnet.public_a.id
}

output "private_app_subnet_id" {
  value = aws_subnet.private_app_a.id
}

output "private_data_subnet_id" {
  value = aws_subnet.private_data_a.id
}
