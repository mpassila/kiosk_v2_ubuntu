import axios, { AxiosInstance } from 'axios';

const clients: { [id: string]: { baseUrl: string; client: AxiosInstance } } = {};

// eslint-disable-next-line prettier/prettier

const createRestClient = (
  id: string,
  baseURL: string,
  headers?: Record<string, string>,
): AxiosInstance => {
  // eslint-disable-next-line no-undef
  const client = axios.create({
    baseURL,
    headers,
    withCredentials: false,
  });

  clients[id] = { baseUrl: baseURL, client };
  return client;
}

const createRestClientForFile = (
  id: string,
  baseURL: string,
  headers?: Record<string, string>,
): AxiosInstance => {
  // eslint-disable-next-line no-undef
  const client = axios.create({
    baseURL,
    headers,
    withCredentials: false,
    responseType: 'arraybuffer'
  });

  clients[id] = { baseUrl: baseURL, client };
  return client;
};

const useRestClient = (id: string): AxiosInstance => {
  if (!clients[id]) {
    throw new Error('Client error: Axios client has not been created');
  }

  return clients[id].client
}

export { createRestClient, useRestClient, createRestClientForFile}
