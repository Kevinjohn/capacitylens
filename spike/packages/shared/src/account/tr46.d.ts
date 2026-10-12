declare module "tr46" {
  /**
   * Defines the IDNA checks used when converting a domain name to ASCII.
   */
  export interface ToASCIIOptions {
    checkBidi?: boolean;
    checkJoiners?: boolean;
    ignoreInvalidPunycode?: boolean;
    transitionalProcessing?: boolean;
    useSTD3ASCIIRules?: boolean;
    verifyDNSLength?: boolean;
  }

  /**
   * Converts a domain name for comparison and storage using the shared IDNA implementation.
   */
  export function toASCII(domainName: string, options?: ToASCIIOptions): string | null;
}
