from app.services.rag import RAGService

rag = RAGService()

count = rag.build_index_from_csv()

print(f"Created {count} chunks")