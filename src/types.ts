/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ZabbixItem {
  itemid: string;
  name: string;
  lastvalue: string;
  units: string;
  key_: string;
  value_type: string;
}

export interface ZabbixHost {
  hostid: string;
  host: string;
  name: string;
}

export interface MetricData {
  time: string;
  value: number;
}

export interface ServerImage {
  id: string;
  url: string;
}

export interface ServerNoteItem {
  id: string;
  text: string;
  completed?: boolean;
}

export interface FileServer {
  id: string;
  name: string;
  zabbixHostname: string;
  description: string;
  images?: ServerImage[];
  notes?: ServerNoteItem[];
  noteText?: string;
}
