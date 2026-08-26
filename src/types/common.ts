export type ActiveModelTab = 'dcf' | 'lbo';

export interface DealPreset {
  id: string;
  name: string;
  industry: string;
  description: string;
  dcf: any;
  lbo: any;
}

export interface SensitivityCell {
  rowValue: number;
  colValue: number;
  resultValue: number;
  formattedResult: string;
  isBaseCase?: boolean;
}

export interface SensitivityMatrix {
  rowHeader: string;
  colHeader: string;
  rowValues: number[];
  colValues: number[];
  matrix: SensitivityCell[][];
  metricName: string;
}
