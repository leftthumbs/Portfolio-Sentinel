import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  convertInchesToTwip,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";
import type { MemoTemplateType } from "@shared/schema";

interface MemoData {
  title: string;
  content: string;
  templateType: MemoTemplateType;
}

// Template-specific color schemes
const EVEREST_COLORS = {
  primary: "1E3A5F",      // Deep navy blue
  secondary: "2C5282",    // Medium blue
  accent: "3182CE",       // Bright blue
  lightGray: "F7FAFC",
  mediumGray: "E2E8F0",
  darkGray: "4A5568",
  white: "FFFFFF",
  black: "1A202C",
};

const VERITA_COLORS = {
  primary: "E64615",      // Verita orange-red for titles
  secondary: "333333",    // Dark gray
  accent: "666666",       // Medium gray
  lightGray: "F5F5F5",
  mediumGray: "E0E0E0",
  darkGray: "4A4A4A",
  white: "FFFFFF",
  black: "000000",
};

const EXECUTIVE_COLORS = {
  primary: "2D3748",      // Slate gray
  secondary: "4A5568",    // Gray
  accent: "718096",       // Light slate
  lightGray: "F7FAFC",
  mediumGray: "E2E8F0",
  darkGray: "4A5568",
  white: "FFFFFF",
  black: "1A202C",
};

const INVESTMENT_SUMMARY_COLORS = {
  primary: "1A365D",      // Dark navy
  secondary: "2B6CB0",    // Blue
  accent: "4299E1",       // Light blue
  lightGray: "EBF8FF",
  mediumGray: "BEE3F8",
  darkGray: "2C5282",
  white: "FFFFFF",
  black: "1A202C",
};

function getColorsForTemplate(templateType: MemoTemplateType) {
  switch (templateType) {
    case "everest_investment_summary":
      return EVEREST_COLORS;
    case "verita_investment_memo":
      return VERITA_COLORS;
    case "verita_investment_summary":
      return VERITA_COLORS;
    case "investment_summary":
      return INVESTMENT_SUMMARY_COLORS;
    case "institutional":
    default:
      return EXECUTIVE_COLORS;
  }
}

// Verita templates use DM Sans font
function getFontForTemplate(templateType: MemoTemplateType): string | undefined {
  if (templateType === "verita_investment_memo" || templateType === "verita_investment_summary") {
    return "DM Sans";
  }
  return undefined;
}

// Verita templates use 10.5pt (21 half-points) as base size
function getBaseSizeForTemplate(templateType: MemoTemplateType): number {
  if (templateType === "verita_investment_memo" || templateType === "verita_investment_summary") {
    return 21; // 10.5pt
  }
  return 22; // 11pt default
}

// Verita body text color
function getBodyColorForTemplate(templateType: MemoTemplateType): string | undefined {
  if (templateType === "verita_investment_memo" || templateType === "verita_investment_summary") {
    return "7A0000"; // Dark red
  }
  return undefined;
}

type ColorScheme = ReturnType<typeof getColorsForTemplate>;

function createTableBorders(colors: ColorScheme) {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: colors.mediumGray },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.mediumGray },
    left: { style: BorderStyle.SINGLE, size: 1, color: colors.mediumGray },
    right: { style: BorderStyle.SINGLE, size: 1, color: colors.mediumGray },
  };
}

function createHeaderCell(text: string, colors: ColorScheme, width?: number, font?: string, size?: number): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            color: colors.white,
            size: size || 20,
            font: font,
          }),
        ],
      }),
    ],
    shading: { fill: colors.primary, type: ShadingType.CLEAR },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: {
      top: convertInchesToTwip(0.08),
      bottom: convertInchesToTwip(0.08),
      left: convertInchesToTwip(0.1),
      right: convertInchesToTwip(0.1),
    },
  });
}

function createDataCell(text: string, colors: ColorScheme, isAlternate: boolean = false, font?: string, size?: number): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: size || 20,
            color: colors.black,
            font: font,
          }),
        ],
      }),
    ],
    shading: isAlternate
      ? { fill: colors.lightGray, type: ShadingType.CLEAR }
      : undefined,
    margins: {
      top: convertInchesToTwip(0.06),
      bottom: convertInchesToTwip(0.06),
      left: convertInchesToTwip(0.1),
      right: convertInchesToTwip(0.1),
    },
  });
}

function createLabelCell(text: string, colors: ColorScheme, isAlternate: boolean = false, font?: string, size?: number): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            size: size || 20,
            color: colors.darkGray,
            font: font,
          }),
        ],
      }),
    ],
    shading: isAlternate
      ? { fill: colors.lightGray, type: ShadingType.CLEAR }
      : undefined,
    width: { size: 30, type: WidthType.PERCENTAGE },
    margins: {
      top: convertInchesToTwip(0.06),
      bottom: convertInchesToTwip(0.06),
      left: convertInchesToTwip(0.1),
      right: convertInchesToTwip(0.1),
    },
  });
}

interface ParsedSection {
  type: "heading1" | "heading2" | "heading3" | "paragraph" | "table" | "bullet" | "risk_mitigant";
  content: string;
  rows?: string[][];
  risk?: string;
  mitigant?: string;
}

function parseMarkdownContent(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = content.split("\n");
  let i = 0;
  let currentTable: string[][] = [];
  let inTable = false;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith("# ")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      sections.push({ type: "heading1", content: line.substring(2) });
    } else if (line.startsWith("## ")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      sections.push({ type: "heading2", content: line.substring(3) });
    } else if (line.startsWith("### ")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      sections.push({ type: "heading3", content: line.substring(4) });
    } else if (line.startsWith("|") && line.endsWith("|")) {
      if (line.includes("---")) {
        i++;
        continue;
      }
      inTable = true;
      const cells = line
        .split("|")
        .filter((c) => c.trim())
        .map((c) => c.trim().replace(/\*\*/g, ""));
      currentTable.push(cells);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      sections.push({ type: "bullet", content: line.substring(2) });
    } else if (line.startsWith("**Risk:**")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      const riskContent = line.substring(9).trim();
      let mitigantContent = "";
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("**Mitigant:**")) {
        i++;
        mitigantContent = lines[i].trim().substring(13).trim();
      }
      sections.push({
        type: "risk_mitigant",
        content: "",
        risk: riskContent,
        mitigant: mitigantContent,
      });
    } else if (line.length > 0 && !line.startsWith("---")) {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
      const cleanedLine = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
      sections.push({ type: "paragraph", content: cleanedLine });
    } else {
      if (inTable && currentTable.length > 0) {
        sections.push({ type: "table", content: "", rows: currentTable });
        currentTable = [];
        inTable = false;
      }
    }
    i++;
  }

  if (inTable && currentTable.length > 0) {
    sections.push({ type: "table", content: "", rows: currentTable });
  }

  return sections;
}

function createTableFromRows(rows: string[][], colors: ColorScheme, font?: string, size?: number): Table {
  const tableRows = rows.map((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const isAlternate = rowIndex % 2 === 0;

    return new TableRow({
      children: row.map((cell, cellIndex) => {
        if (isHeader) {
          return createHeaderCell(cell, colors, cellIndex === 0 ? 35 : undefined, font, size);
        } else if (cellIndex === 0) {
          return createLabelCell(cell, colors, isAlternate, font, size);
        } else {
          return createDataCell(cell, colors, isAlternate, font, size);
        }
      }),
    });
  });

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: createTableBorders(colors),
  });
}

function createRiskMitigantTable(risk: string, mitigant: string, colors: ColorScheme, font?: string, size?: number): Table {
  return new Table({
    rows: [
      new TableRow({
        children: [
          createHeaderCell("Risk", colors, 20, font, size),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: risk, size: size || 20, font: font })],
              }),
            ],
            margins: {
              top: convertInchesToTwip(0.06),
              bottom: convertInchesToTwip(0.06),
              left: convertInchesToTwip(0.1),
              right: convertInchesToTwip(0.1),
            },
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Mitigant", bold: true, size: size || 20, color: colors.white, font: font }),
                ],
              }),
            ],
            shading: { fill: colors.secondary, type: ShadingType.CLEAR },
            margins: {
              top: convertInchesToTwip(0.06),
              bottom: convertInchesToTwip(0.06),
              left: convertInchesToTwip(0.1),
              right: convertInchesToTwip(0.1),
            },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: mitigant, size: size || 20, font: font })],
              }),
            ],
            shading: { fill: colors.lightGray, type: ShadingType.CLEAR },
            margins: {
              top: convertInchesToTwip(0.06),
              bottom: convertInchesToTwip(0.06),
              left: convertInchesToTwip(0.1),
              right: convertInchesToTwip(0.1),
            },
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: createTableBorders(colors),
  });
}

function getFooterText(templateType: MemoTemplateType): string {
  switch (templateType) {
    case "everest_investment_summary":
      return "Everest Private Wealth Investment Research | ";
    case "verita_investment_memo":
      return "Investment Memo | ";
    case "verita_investment_summary":
      return "Verita Investment Summary | ";
    case "investment_summary":
      return "Investment Summary | ";
    case "institutional":
    default:
      return "Executive Summary | ";
  }
}

export async function generateWordDocument(memoData: MemoData): Promise<Buffer> {
  const { title, content, templateType } = memoData;
  const sections = parseMarkdownContent(content);
  const colors = getColorsForTemplate(templateType);
  const font = getFontForTemplate(templateType);
  const baseSize = getBaseSizeForTemplate(templateType);
  const bodyColor = getBodyColorForTemplate(templateType);
  const isEverest = templateType === "everest_investment_summary";
  const isVerita = templateType === "verita_investment_memo";
  const isVeritaSummary = templateType === "verita_investment_summary";
  const isVeritaTemplate = isVerita || isVeritaSummary;

  const documentChildren: (Paragraph | Table)[] = [];

  // Template-specific header branding
  if (isEverest) {
    documentChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "EVEREST PRIVATE WEALTH",
            bold: true,
            size: 36,
            color: colors.primary,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "INVESTMENT SUMMARY",
            bold: true,
            size: 28,
            color: colors.secondary,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  } else if (isVerita) {
    // Verita Investment Memo has a clean, professional header with DM Sans 48pt
    documentChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "INVESTMENT MEMORANDUM",
            bold: true,
            size: 96,  // 48pt
            color: colors.primary,
            font: font,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  } else if (isVeritaSummary) {
    // Verita Investment Summary has a clean, professional header with DM Sans 48pt
    documentChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "INVESTMENT SUMMARY",
            bold: true,
            size: 96,  // 48pt
            color: colors.primary,
            font: font,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  }

  for (const section of sections) {
    switch (section.type) {
      case "heading1":
        if (section.content.includes("EVEREST") && isEverest) continue;
        if (section.content.toLowerCase().includes("investment memorandum") && isVerita) continue;
        if (section.content.toLowerCase().includes("investment summary") && isVeritaSummary) continue;
        documentChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.content,
                bold: true,
                size: isVeritaTemplate ? 56 : 32,  // 28pt for Verita
                color: isVeritaTemplate ? "7A0000" : colors.primary,  // Dark red for Verita
                font: font,
              }),
            ],
            spacing: { before: 400, after: 200 },
          })
        );
        break;

      case "heading2":
        if (section.content === "INVESTMENT SUMMARY" && isEverest) continue;
        documentChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.content,
                bold: true,
                size: isVeritaTemplate ? 36 : 26,  // 18pt for Verita
                color: isVeritaTemplate ? "E64615" : colors.primary,  // Orange-red for Verita
                font: font,
              }),
            ],
            spacing: { before: 300, after: 150 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: isVeritaTemplate ? "E64615" : colors.accent },
            },
          })
        );
        break;

      case "heading3":
        documentChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.content,
                bold: true,
                size: isVeritaTemplate ? 28 : 22,
                color: colors.secondary,
                font: font,
              }),
            ],
            spacing: { before: 200, after: 100 },
          })
        );
        break;

      case "paragraph":
        documentChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.content,
                size: baseSize,
                font: font,
                color: bodyColor,
              }),
            ],
            spacing: { after: 120 },
          })
        );
        break;

      case "bullet":
        documentChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "• " + section.content,
                size: baseSize,
                font: font,
                color: bodyColor,
              }),
            ],
            indent: { left: convertInchesToTwip(0.25) },
            spacing: { after: 80 },
          })
        );
        break;

      case "table":
        if (section.rows && section.rows.length > 0) {
          documentChildren.push(createTableFromRows(section.rows, colors, font, baseSize));
          documentChildren.push(new Paragraph({ spacing: { after: 200 } }));
        }
        break;

      case "risk_mitigant":
        if (section.risk && section.mitigant) {
          documentChildren.push(createRiskMitigantTable(section.risk, section.mitigant, colors, font, baseSize));
          documentChildren.push(new Paragraph({ spacing: { after: 150 } }));
        }
        break;
    }
  }

  const doc = new Document({
    styles: {
      default: {
        heading1: {
          run: {
            size: 32,
            bold: true,
            color: colors.primary,
          },
          paragraph: {
            spacing: { before: 400, after: 200 },
          },
        },
        heading2: {
          run: {
            size: 26,
            bold: true,
            color: colors.secondary,
          },
          paragraph: {
            spacing: { before: 300, after: 150 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: title,
                    size: 18,
                    color: colors.darkGray,
                    italics: true,
                  }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: getFooterText(templateType),
                    size: 16,
                    color: colors.darkGray,
                  }),
                  new TextRun({
                    text: "Page ",
                    size: 16,
                    color: colors.darkGray,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: colors.darkGray,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: documentChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}
