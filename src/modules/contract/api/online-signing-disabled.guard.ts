import { CanActivate, ConflictException, Injectable } from "@nestjs/common";

/** Keep legacy routes discoverable while all contracts are signed manually. */
@Injectable()
export class OnlineSigningDisabledGuard implements CanActivate {
  canActivate(): never {
    throw new ConflictException({
      code: "MANUAL_SIGNATURE_REQUIRED",
      message: "Online signing is temporarily disabled. Ask the expert to confirm the signed paper contract and payment.",
    });
  }
}
