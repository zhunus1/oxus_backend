import { Request } from "express";
import { JwtPayloadDto } from "./jwt-payload.dto";

export interface UserRequest extends Request {
  user: JwtPayloadDto;
}
