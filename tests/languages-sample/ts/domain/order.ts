import { charge } from "../app/service";
import { compact } from "lodash";
export const total = (n: number) => charge(n);
