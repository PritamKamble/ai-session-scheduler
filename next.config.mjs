/** @type {import('next').NextConfig} */
const nextConfig = {
     env: {
        PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  }
};

export default nextConfig;
