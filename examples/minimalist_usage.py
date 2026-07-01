#!/usr/bin/env python3
"""
Example showing the improved, minimalist Dalux Build API usage.
"""

from dalux_build import create_client, find_by_field

def main():
    """Demonstrate the improved API design."""
    
    # Create client (loads from environment variables)
    dalux = create_client()
    
    # 1. Simple pagination - get all projects
    print("=== Getting all projects ===")
    projects_response = dalux.projects.list_projects()
    
    # Use the generic find utility
    specific_project = find_by_field(
        projects_response.items,
        "projectName",
        "My Project"
    )
    
    if specific_project:
        print(f"Found project: {specific_project.project_name} (ID: {specific_project.project_id})")
    else:
        print("Project not found")
    
    # 2. Get folders with automatic pagination
    print("\n=== Getting all folders ===")
    if projects_response.items:
        project_id = projects_response.items[0].project_id
        file_areas = dalux.file_areas.get_file_areas(project_id)
        
        if file_areas and file_areas.items:
            file_area_id = file_areas.items[0].file_area_id
            
            # Use the simplified pagination
            all_folders = dalux.folders.get_all_folders(project_id, file_area_id, verbose=True)
            print(f"Retrieved {len(all_folders)} folders")
            
            # Find specific folder using utility
            drawings_folder = find_by_field(
                all_folders,
                "folderName",
                "Drawings",
                accessor=lambda x: x.get("data") if isinstance(x, dict) and "data" in x else x
            )
            
            if drawings_folder:
                folder_data = drawings_folder.get("data") or drawings_folder
                print(f"Found Drawings folder: {folder_data.get('folderId')}")
    
    # 3. Error handling with custom exceptions
    print("\n=== Error handling example ===")
    try:
        # This will raise NotFoundError
        dalux.projects.get_project("non-existent-project-id")
    except Exception as e:
        print(f"Caught exception: {type(e).__name__}: {e}")
    
    print("\n=== API usage complete ===")

if __name__ == "__main__":
    main()