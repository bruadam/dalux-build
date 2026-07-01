"""Test that the download methods work with Pydantic File objects."""
import responses as rsps_lib
import tempfile
import os
from dalux_build.api import FilesApi
from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration

BASE_URL = "https://api.example.com/build"
API_KEY = "test-key-abc"

def _make_client():
    """Return a real ApiClient whose HTTP layer is intercepted by `responses`."""
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    return ApiClient(config)

@rsps_lib.activate
def test_bulk_download_by_ids():
    """Test that bulk_download_by_ids works with FileResponse objects."""
    
    # Mock the get_file response (returns FileResponse object)
    file_response = {
        "data": {
            "fileId": "test_file_id",
            "fileName": "test.txt",
            "fileAreaId": "test_area",
            "fileType": "document",
            "downloadLink": f"{BASE_URL}/download/test.txt"
        }
    }
    
    # Mock the file download
    file_content = b"Hello, World!"
    
    rsps_lib.add(
        rsps_lib.GET, 
        f"{BASE_URL}/5.0/projects/p1/file_areas/fa1/files/test_file_id",
        json=file_response,
        status=200
    )
    rsps_lib.add(
        rsps_lib.GET,
        f"{BASE_URL}/download/test.txt",
        body=file_content,
        status=200
    )
    
    api = FilesApi(_make_client())
    
    with tempfile.TemporaryDirectory() as temp_dir:
        results = api.bulk_download_by_ids(
            project_id="p1",
            file_area_id="fa1",
            file_ids=["test_file_id"],
            save_path=temp_dir,
            verbose=True
        )
        
        assert len(results) == 1
        assert results[0]["fileId"] == "test_file_id"
        assert results[0]["fileName"] == "test.txt"
        
        # Verify the file was downloaded
        downloaded_path = results[0]["downloaded_file_path"]
        assert os.path.exists(downloaded_path)
        
        with open(downloaded_path, 'rb') as f:
            content = f.read()
        assert content == file_content
        
        print("✓ bulk_download_by_ids works correctly with FileResponse objects")


@rsps_lib.activate
def test_bulk_download_folder():
    """Test that bulk_download_folder works with File objects."""
    
    # Mock the list files response (returns File objects)
    files_response = {
        "items": [
            {"data": {
                "fileId": "file1",
                "fileName": "document.pdf",
                "fileAreaId": "fa1",
                "folderId": "folder1",
                "fileType": "document",
                "downloadLink": f"{BASE_URL}/download/doc.pdf"
            }},
            {"data": {
                "fileId": "file2",
                "fileName": "image.png",
                "fileAreaId": "fa1",
                "folderId": "folder1",
                "fileType": "document",
                "downloadLink": f"{BASE_URL}/download/img.png"
            }}
        ],
        "metadata": {"totalItems": 2, "totalRemainingItems": 0},
        "links": []
    }
    
    # Mock file downloads
    pdf_content = b"PDF content"
    png_content = b"PNG content"
    
    rsps_lib.add(
        rsps_lib.GET,
        f"{BASE_URL}/6.1/projects/p1/file_areas/fa1/files",
        json=files_response,
        status=200
    )
    rsps_lib.add(
        rsps_lib.GET,
        f"{BASE_URL}/download/doc.pdf",
        body=pdf_content,
        status=200
    )
    rsps_lib.add(
        rsps_lib.GET,
        f"{BASE_URL}/download/img.png",
        body=png_content,
        status=200
    )
    
    api = FilesApi(_make_client())
    
    with tempfile.TemporaryDirectory() as temp_dir:
        results = api.bulk_download_folder(
            project_id="p1",
            file_area_id="fa1",
            folder_id="folder1",
            save_path=temp_dir,
            verbose=True
        )
        
        assert len(results) == 2
        
        # Verify both files were downloaded
        for result in results:
            downloaded_path = result["downloaded_file_path"]
            assert os.path.exists(downloaded_path)
            print(f"✓ Downloaded: {result['fileName']}")
        
        print("✓ bulk_download_folder works correctly with File objects")


if __name__ == "__main__":
    test_bulk_download_by_ids()
    test_bulk_download_folder()
    print("✓ All download method tests passed!")
