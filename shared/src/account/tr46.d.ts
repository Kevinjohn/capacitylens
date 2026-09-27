declare module "tr46" {
  export interface ToASCIIOptions {
    checkBidi?: boolean;
    checkJoiners?: boolean;
    ignoreInvalidPunycode?: boolean;
    transitionalProcessing?: boolean;
    useSTD3ASCIIRules?: boolean;
    verifyDNSLength?: boolean;
  }

  export function toASCII(domainName: string, options?: ToASCIIOptions): string | null;
}
