export type IpInfo = {
  ip: string;
  private?: boolean;
  ok: boolean;
  error?: string;
  city?: string; region?: string; country?: string; countryCode?: string;
  lat?: number; lon?: number; timezone?: string;
  isp?: string; org?: string; as?: string; asname?: string; reverse?: string;
  mobile?: boolean; proxy?: boolean; hosting?: boolean;
};
