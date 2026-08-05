import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetrieveDocumentResponseDto {
  @ApiProperty({ description: 'Internal UUID.' })
  id: string;

  @ApiProperty({ description: 'Citation number (e.g. "01/2026/QH16").' })
  citationId: string;

  @ApiProperty({ description: 'Full document title.' })
  title: string;

  @ApiProperty({ description: 'Document type (e.g. "Luật", "Nghị định").' })
  documentType: string;

  @ApiProperty({ description: 'Issuing body name.' })
  issuingBody: string;

  @ApiProperty({ nullable: true, description: 'Industry category.' })
  industry: string | null;

  @ApiProperty({ nullable: true, description: 'Field/domain category.' })
  field: string | null;

  @ApiProperty({ nullable: true, description: 'Name of the person who signed.' })
  signerName: string | null;

  @ApiProperty({ nullable: true, description: 'Title/role of the signer.' })
  signerTitle: string | null;

  @ApiProperty({ nullable: true, description: 'Date enacted (dd/mm/yyyy).' })
  enactedDate: string | null;

  @ApiProperty({ nullable: true, description: 'Date effective (dd/mm/yyyy).' })
  effectiveDate: string | null;

  @ApiProperty({ nullable: true, description: 'Date published in official gazette (dd/mm/yyyy).' })
  gazettePublishedDate: string | null;

  @ApiProperty({ description: 'Validity status (e.g. "Còn hiệu lực").' })
  validityStatus: string;

  @ApiProperty({ description: 'Whether this is a consolidated document (văn bản hợp nhất).' })
  isConsolidated: boolean;

  @ApiProperty({ nullable: true, description: 'UUID of the document this consolidates.' })
  consolidatesDocumentId: string | null;

  @ApiProperty({ description: 'vbpl.vn source URL.' })
  sourceUrl: string;
}