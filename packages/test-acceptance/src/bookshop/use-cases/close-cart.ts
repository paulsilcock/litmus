import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";

import type { CartId } from "../domain/cart.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";

interface CloseCartCommand extends Record<string, unknown> {
  cartId: CartId;
}

@injectable()
export class CloseCart extends CommandHandler<CloseCartCommand> {
  constructor(private readonly carts: CartRepository) {
    super();
  }

  async handle({ cartId }: CloseCartCommand): Promise<void> {
    const cart = await this.carts.findById(cartId);
    if (!cart || cart.status !== "open") return;
    cart.checkOut();
    await this.carts.update(cart);
  }
}
