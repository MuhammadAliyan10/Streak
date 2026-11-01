declare module '@appeeky/expo-healthkit' {
  export function isAvailable(): boolean;
  export function getSupportedTypes(): string[];
  export function requestAuthorization(input: { toRead: string[] }): Promise<boolean>;
  export function getGrantedPermissions(): Promise<string[]>;
  export function queryStatistics(input: {
    type: string;
    unit: string;
    from: Date;
    to: Date;
    options: number;
  }): Promise<{ startDate: Date; endDate: Date; unit: string; sum?: number }>;
  export const StatisticsOption: { cumulativeSum: number };
}
