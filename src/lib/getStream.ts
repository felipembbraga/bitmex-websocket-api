import axios from "axios";
import url from "url";

export default async function (wsEndpoint: string) {
    const parsed = url.parse(wsEndpoint);
  const httpEndpoint = url.format({
    protocol: parsed.protocol === 'wss:' ? 'https:' : 'http',
    host: parsed.host
  });

  const response = await axios.get(httpEndpoint + '/api/v1/schema/websocketHelp');
  const stream = response.data.subscriptionSubjects;
  return {
      public: stream.public,
      private: stream.authenticationRequired,
      all: stream.public.concat(stream.authenticationRequired)
  }
}