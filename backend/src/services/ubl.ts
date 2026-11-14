import type { Store } from "../store.js";
import type { Order } from "./orders.js";

/**
 * An order as a PEPPOL BIS Order 3.0 document (UBL 2.1). Valio Aimo's mock
 * environment has no order API, so this is what a person forwards, or imports
 * into any system that reads PEPPOL orders. It carries the fixed prices, the
 * delivery date, and a reference to the quote and how it was authorized.
 */

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const amount = (cents: number) => (cents / 100).toFixed(2);

/** UN/ECE Recommendation 20 unit codes for Valio Aimo's sales units. */
function unitCode(salesUnit: string): string {
  if (salesUnit === "KG") return "KGM";
  if (salesUnit === "L" || salesUnit === "LTR") return "LTR";
  if (salesUnit === "KI" || salesUnit === "LTK" || salesUnit === "PAK") return "CS";
  return "H87";
}

/** The kitchen an order is for: the agent's buyer, or the buyer's own organization. */
function buyerOf(store: Store, order: Order): { name: string; agent?: string } {
  const quote = store.quotes.get(order.quoteId);
  const creator = quote?.createdBy;
  const policy = creator && creator.role === "agent" ? store.policies.get(creator.id) : undefined;
  return policy ? { name: policy.buyerName, agent: policy.agentName } : { name: "Buyer" };
}

export function orderToUbl(store: Store, order: Order): string {
  const quote = store.quotes.get(order.quoteId);
  const buyer = buyerOf(store, order);
  const [issueDate, time] = order.placedAt.split("T");
  const issueTime = (time ?? "00:00:00").slice(0, 8);
  const authorization =
    quote?.status === "ordered" && quote.permission.decision === "within_limit"
      ? `Ordered by ${buyer.agent ?? "the agent"} within its authority.`
      : quote?.buyerDecision
        ? `Approved by ${quote.buyerDecision.by.name} on ${quote.buyerDecision.at.slice(0, 10)}.`
        : `Placed by ${order.placedBy.name}.`;

  const lines = order.lines
    .map((line, index) => {
      const gtin = store.catalog.byId.get(line.productId)?.gtin;
      return `  <cac:OrderLine>
    <cac:LineItem>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:Quantity unitCode="${unitCode(line.salesUnit)}">${line.packages}</cbc:Quantity>
      <cbc:LineExtensionAmount currencyID="EUR">${amount(line.lineTotalEurCents)}</cbc:LineExtensionAmount>
      <cac:Delivery>
        <cac:RequestedDeliveryPeriod>
          <cbc:StartDate>${escape(line.deliveryDate)}</cbc:StartDate>
          <cbc:EndDate>${escape(line.deliveryDate)}</cbc:EndDate>
        </cac:RequestedDeliveryPeriod>
      </cac:Delivery>
      <cac:Price>
        <cbc:PriceAmount currencyID="EUR">${amount(line.pricePerPackageEurCents)}</cbc:PriceAmount>
        <cbc:BaseQuantity unitCode="${unitCode(line.salesUnit)}">1</cbc:BaseQuantity>
      </cac:Price>
      <cac:Item>
        <cbc:Name>${escape(line.productName)}</cbc:Name>
        <cac:SellersItemIdentification>
          <cbc:ID>${escape(line.productId)}</cbc:ID>
        </cac:SellersItemIdentification>${
          gtin
            ? `
        <cac:StandardItemIdentification>
          <cbc:ID schemeID="0160">${escape(gtin)}</cbc:ID>
        </cac:StandardItemIdentification>`
            : ""
        }
        <cac:ClassifiedTaxCategory>
          <cbc:ID>S</cbc:ID>
          <cbc:Percent>${line.vatRatePercent}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
    </cac:LineItem>
  </cac:OrderLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:order:3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:bis:order_only:3</cbc:ProfileID>
  <cbc:ID>${escape(order.id)}</cbc:ID>
  <cbc:IssueDate>${escape(issueDate ?? "")}</cbc:IssueDate>
  <cbc:IssueTime>${escape(issueTime)}</cbc:IssueTime>
  <cbc:Note>${escape(`Fixed-price order from quote ${order.quoteId}. ${authorization} Prices exclude VAT.`)}</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:CustomerReference>${escape(order.quoteId)}</cbc:CustomerReference>
  <cac:QuotationDocumentReference>
    <cbc:ID>${escape(order.quoteId)}</cbc:ID>
  </cac:QuotationDocumentReference>
  <cac:BuyerCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escape(buyer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:BuyerCustomerParty>
  <cac:SellerSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Valio Aimo</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Valio Aimo</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:SellerSupplierParty>
  <cac:Delivery>
    <cac:RequestedDeliveryPeriod>
      <cbc:StartDate>${escape(order.deliveryDate)}</cbc:StartDate>
      <cbc:EndDate>${escape(order.deliveryDate)}</cbc:EndDate>
    </cac:RequestedDeliveryPeriod>
  </cac:Delivery>
  <cac:AnticipatedMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amount(order.totalEurCents)}</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="EUR">${amount(order.totalEurCents)}</cbc:PayableAmount>
  </cac:AnticipatedMonetaryTotal>
${lines}
</Order>
`;
}
