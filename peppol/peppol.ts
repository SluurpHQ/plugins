// Peppol BIS Billing 3.0 (UBL 2.1, EN 16931): the e-invoice accounting software and the Peppol network take.
// Installed with `sluurp plugin add peppol`; the example for other invoice formats.
//
// build() gets the invoice as billing has it: { invoice, lines, issuer, payers: [{ id, name, email }],
// account: { id, name }, currency, country }, and gives back the file's text.

type Line = { label: string; detail?: string; quantity: number; unit_cents: number; amount_cents: number };
type Invoice = {
  invoice: { number: string; date: string; due: string; title?: string; reference: string; total_cents: number };
  lines: Line[];
  issuer: { name: string; address?: string; company_no?: string; iban?: string; bic?: string };
  payers: { id: string; name: string; email?: string }[];
  account: { id: string; name: string };
  currency: string;
  country: string;
};

const money = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export const invoiceFormat = {
  name: "peppol",
  label: "E-invoice (UBL) for accounting",
  // Where Peppol is how businesses send invoices. Romania, Italy and Poland have national systems of their own.
  countries: ["BE", "NL", "NO", "SE", "DK", "FI", "IS", "IE", "LU", "AT", "EE", "DE", "FR", "AU", "NZ", "SG", "JP", "MY"],
  contentType: "application/xml",
  extension: "xml",

  build(it: Invoice): string {
    const total = it.invoice.total_cents;
    const credit = total < 0;
    const doc = credit ? "CreditNote" : "Invoice";
    const amount = (cents: number) => ({ "@currencyID": it.currency, "#text": money(cents) });
    const company = (it.issuer.company_no ?? "").replace(/\D/g, "");
    const buyer = it.payers[0] ?? { id: it.account.id, name: it.account.name };
    // In the order UBL's schema has them: endpoint, name, address (a country always, as Peppol asks), legal entity.
    const party = (name: string, endpoint: object | null, street: string) => ({
      "cac:Party": {
        ...(endpoint ? { "cbc:EndpointID": endpoint } : {}),
        "cac:PartyName": { "cbc:Name": name },
        "cac:PostalAddress": { ...(street ? { "cbc:StreetName": street } : {}), "cac:Country": { "cbc:IdentificationCode": it.country } },
        "cac:PartyLegalEntity": { "cbc:RegistrationName": name },
      },
    });
    const exempt = { "cbc:ID": "E", "cbc:Percent": 0 };
    const net = Math.abs(total);
    return Sluurp.XML.stringify({
      [doc]: {
        "@xmlns": `urn:oasis:names:specification:ubl:schema:xsd:${doc}-2`,
        "@xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "@xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
        "cbc:CustomizationID": "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
        "cbc:ProfileID": "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        "cbc:ID": it.invoice.number,
        "cbc:IssueDate": it.invoice.date,
        ...(credit ? {} : { "cbc:DueDate": it.invoice.due }),
        [`cbc:${doc}TypeCode`]: credit ? 381 : 380,
        ...(it.invoice.title ? { "cbc:Note": it.invoice.title } : {}),
        "cbc:DocumentCurrencyCode": it.currency,
        "cbc:BuyerReference": it.account.name || it.account.id,
        "cac:AccountingSupplierParty": party(it.issuer.name, company ? { "@schemeID": "0208", "#text": company } : null, it.issuer.address ?? ""),
        "cac:AccountingCustomerParty": party(buyer.name, buyer.email ? { "@schemeID": "EM", "#text": buyer.email } : null, ""),
        ...(credit || !it.issuer.iban ? {} : {
          "cac:PaymentMeans": {
            "cbc:PaymentMeansCode": 58,
            "cbc:PaymentID": it.invoice.reference,
            "cac:PayeeFinancialAccount": {
              "cbc:ID": it.issuer.iban.replace(/\s/g, ""),
              ...(it.issuer.bic ? { "cac:FinancialInstitutionBranch": { "cbc:ID": it.issuer.bic } } : {}),
            },
          },
        }),
        "cac:TaxTotal": {
          "cbc:TaxAmount": amount(0),
          "cac:TaxSubtotal": {
            "cbc:TaxableAmount": amount(net),
            "cbc:TaxAmount": amount(0),
            "cac:TaxCategory": { ...exempt, "cbc:TaxExemptionReason": "Exempt", "cac:TaxScheme": { "cbc:ID": "VAT" } },
          },
        },
        "cac:LegalMonetaryTotal": {
          "cbc:LineExtensionAmount": amount(net),
          "cbc:TaxExclusiveAmount": amount(net),
          "cbc:TaxInclusiveAmount": amount(net),
          "cbc:PayableAmount": amount(net),
        },
        [`cac:${doc}Line`]: it.lines.map((l, n) => ({
          "cbc:ID": n + 1,
          [credit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity"]: { "@unitCode": "C62", "#text": credit ? -l.quantity : l.quantity },
          "cbc:LineExtensionAmount": amount(credit ? -l.amount_cents : l.amount_cents),
          "cac:Item": {
            "cbc:Name": [l.label, l.detail].filter(Boolean).join(" — "),
            "cac:ClassifiedTaxCategory": { ...exempt, "cac:TaxScheme": { "cbc:ID": "VAT" } },
          },
          "cac:Price": { "cbc:PriceAmount": amount(Math.abs(l.unit_cents)) },
        })),
      },
    }) + "\n";
  },
};
