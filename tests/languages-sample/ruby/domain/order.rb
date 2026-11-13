require_relative "../app/service"
require_relative "../gen/schema"
require "json"

class Order
  def s = Shop::Service.new
end
