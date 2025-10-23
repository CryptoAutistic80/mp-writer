import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AddressesService } from './addresses.service';

@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get('lookup')
  async lookup(@Query('postcode') postcode?: string) {
    if (!postcode) throw new BadRequestException('postcode is required');
    const items = await this.addresses.lookup(postcode);
    return { items };
  }

  @Get('get')
  async get(@Query('id') id?: string, @Query('postcode') postcode?: string) {
    if (!id) throw new BadRequestException('id is required');
    const item = await this.addresses.getAddressById(id, postcode);
    if (!item) throw new BadRequestException('Address not found');
    return { item };
  }
}
