"""Tests for version set file download functionality."""

import datetime
from unittest.mock import MagicMock, patch

from dalux_build.models import (
    DownloadResult,
    File,
    FileNameFilter,
    MissingFileReport,
)


class TestFileNameFilterRegexWildcard:
    """Test enhanced FileNameFilter with regex and wildcard support."""

    def test_regex_pattern_simple(self):
        """Test regex pattern matching."""
        filter_obj = FileNameFilter(pattern=r"\.pdf$")
        # Test would be done in FilesApi._matches_file_filter
        # This just tests the model can be created
        assert filter_obj.pattern == r"\.pdf$"
        assert filter_obj.patterns is None

    def test_regex_multiple_patterns(self):
        """Test multiple regex patterns."""
        filter_obj = FileNameFilter(patterns=[r"\.pdf$", r"\.rvt$"])
        assert filter_obj.patterns == [r"\.pdf$", r"\.rvt$"]

    def test_wildcard_simple(self):
        """Test wildcard pattern matching."""
        filter_obj = FileNameFilter(wildcard="*.pdf")
        assert filter_obj.wildcard == "*.pdf"

    def test_wildcard_multiple(self):
        """Test multiple wildcard patterns."""
        filter_obj = FileNameFilter(wildcards=["*.pdf", "*.rvt"])
        assert filter_obj.wildcards == ["*.pdf", "*.rvt"]

    def test_combined_filters(self):
        """Test filter with both traditional and new fields."""
        filter_obj = FileNameFilter(
            contains=["LLYN"],
            extensions=[".pdf"],
            pattern=r"\.pdf$",
            wildcard="LLYN*.pdf",
        )
        assert filter_obj.contains == ["LLYN"]
        assert filter_obj.extensions == [".pdf"]
        assert filter_obj.pattern == r"\.pdf$"
        assert filter_obj.wildcard == "LLYN*.pdf"


class TestMissingFileReport:
    """Test MissingFileReport model."""

    def test_basic_report(self):
        """Test basic MissingFileReport creation."""
        report = MissingFileReport(
            version_set_id="vs1",
            missing_files=["file1.pdf", "file2.rvt"],
            missing_download_links=["file3.pdf"],
        )
        assert report.version_set_id == "vs1"
        assert report.missing_files == ["file1.pdf", "file2.rvt"]
        assert report.missing_download_links == ["file3.pdf"]

    def test_empty_report(self):
        """Test empty MissingFileReport."""
        report = MissingFileReport(version_set_id="vs2")
        assert report.missing_files == []
        assert report.missing_download_links == []


class TestDownloadResult:
    """Test DownloadResult model."""

    def test_basic_result(self):
        """Test basic DownloadResult creation."""
        file1 = File(
            file_id="S1",
            file_name="test1.pdf",
            file_area_id="fa1",
            download_link="https://example.com/file1",
            uploaded=datetime.date(2024, 1, 1),
        )

        result = DownloadResult(
            downloaded_files=[file1],
            skipped_files=[],
            failed_files=[],
            missing_report={"vs1": MissingFileReport(version_set_id="vs1")},
        )
        assert len(result.downloaded_files) == 1
        assert result.downloaded_files[0].file_name == "test1.pdf"
        assert len(result.skipped_files) == 0
        assert len(result.failed_files) == 0
        assert "vs1" in result.missing_report


class TestVersionSetsApiMatchesFile:
    """Test file matching logic in VersionSetsApi."""

    def _make_api(self):
        """Create a VersionSetsApi instance for testing."""
        mock_client = MagicMock()
        mock_client.configuration.api_key = "test_key"
        from dalux_build.api.version_sets import VersionSetsApi

        return VersionSetsApi(mock_client)

    def test_match_by_file_id(self):
        """Test matching by file_id."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
        )

        # Exact file_id match
        assert api._matches_file(file_obj, "S123456")
        assert not api._matches_file(file_obj, "S999999")

    def test_match_by_file_name(self):
        """Test matching by exact file_name."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
        )

        assert api._matches_file(file_obj, "test.pdf")
        assert not api._matches_file(file_obj, "other.pdf")

    def test_match_by_wildcard(self):
        """Test matching by wildcard pattern."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="LLYN_B250_K01.pdf",
            file_area_id="fa1",
        )

        assert api._matches_file(file_obj, "LLYN*.pdf")
        assert api._matches_file(file_obj, "*.pdf")
        assert api._matches_file(file_obj, "LLYN_B250*")
        assert not api._matches_file(file_obj, "*.rvt")

    def test_match_by_regex(self):
        """Test matching by regex pattern."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="LLYN.B250_K01_T99.pdf",
            file_area_id="fa1",
        )

        assert api._matches_file(file_obj, r"LLYN\.B250.*\.pdf")
        assert api._matches_file(file_obj, r"\.pdf$")
        assert not api._matches_file(file_obj, r"\.rvt$")

    def test_match_by_file_name_filter(self):
        """Test matching by FileNameFilter object."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="LLYN.B250_K01_T99.pdf",
            file_area_id="fa1",
        )

        # Filter by extension
        filter_obj = FileNameFilter(extensions=[".pdf"])
        assert api._matches_file(file_obj, filter_obj)

        # Filter by contains
        filter_obj = FileNameFilter(contains=["LLYN", "B250"])
        assert api._matches_file(file_obj, filter_obj)

        # Filter by startswith
        filter_obj = FileNameFilter(startswith=["LLYN"])
        assert api._matches_file(file_obj, filter_obj)

        # Filter by endswith
        filter_obj = FileNameFilter(endswith=[".pdf"])
        assert api._matches_file(file_obj, filter_obj)

        # Filter by regex pattern
        filter_obj = FileNameFilter(pattern=r"LLYN\.B250.*\.pdf")
        assert api._matches_file(file_obj, filter_obj)

        # Filter by wildcard
        filter_obj = FileNameFilter(wildcard="LLYN*.pdf")
        assert api._matches_file(file_obj, filter_obj)

    def test_no_match(self):
        """Test cases where file should not match."""
        api = self._make_api()
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
        )

        # Wrong file_id
        assert not api._matches_file(file_obj, "S999999")

        # Wrong file_name
        assert not api._matches_file(file_obj, "other.pdf")

        # Wrong extension wildcard
        assert not api._matches_file(file_obj, "*.rvt")

        # Wrong extension regex
        assert not api._matches_file(file_obj, r"\.rvt$")


class TestVersionSetsApiDownloadFiles:
    """Test download_files method in VersionSetsApi."""

    def _make_api(self):
        """Create a VersionSetsApi instance for testing."""
        mock_client = MagicMock()
        mock_client.configuration.api_key = "test_key"
        mock_client.configuration.project_id = None
        from dalux_build.api.version_sets import VersionSetsApi

        return VersionSetsApi(mock_client)

    def test_empty_identifiers(self):
        """Test with empty identifiers list."""
        api = self._make_api()

        with patch.object(api, "get_version_sets", return_value=[]):
            result = api.download_files(
                identifiers=[],
                version_set_ids=None,
                project_id="p1",
            )

        assert len(result.downloaded_files) == 0
        assert len(result.skipped_files) == 0
        assert len(result.failed_files) == 0
        assert len(result.missing_report) == 0

    def test_no_version_sets(self):
        """Test when no version sets exist."""
        api = self._make_api()

        with patch.object(api, "get_version_sets", return_value=[]):
            result = api.download_files(
                identifiers=["test.pdf"],
                version_set_ids=None,
                project_id="p1",
            )

        assert len(result.downloaded_files) == 0
        assert len(result.skipped_files) == 0
        assert len(result.failed_files) == 0
        assert len(result.missing_report) == 0

    @patch("dalux_build.api.version_sets.download_file_with_metadata")
    def test_download_success(self, mock_download):
        """Test successful file download."""
        api = self._make_api()

        # Create mock file
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
            file_revision_id="R1",
            download_link="https://example.com/file.pdf",
            uploaded=datetime.date(2024, 1, 1),
        )

        mock_version_set = MagicMock()
        mock_version_set.version_set_id = "vs1"

        with patch.object(api, "get_version_sets", return_value=[mock_version_set]):
            with patch.object(api, "list_version_set_files", return_value=[file_obj]):
                with patch.object(api, "_client") as mock_client:
                    mock_client._configuration.api_key = "test_key"
                    mock_download.return_value = file_obj

                    result = api.download_files(
                        identifiers=["test.pdf"],
                        version_set_ids=None,
                        project_id="p1",
                    )

        assert len(result.downloaded_files) == 1
        assert result.downloaded_files[0].file_name == "test.pdf"
        assert "vs1" in result.missing_report

    @patch("dalux_build.api.version_sets.download_file_with_metadata")
    def test_download_success_with_file_name_filter_identifier(self, mock_download):
        """FileNameFilter identifiers must not raise TypeError: unhashable type.

        Regression test: found_identifiers used to be a set of raw
        identifiers, which broke because FileNameFilter (a pydantic model)
        isn't hashable.
        """
        api = self._make_api()

        file_obj = File(
            file_id="S123456",
            file_name="LLYN.B250_K01_F03.ifc",
            file_area_id="fa1",
            file_revision_id="R1",
            download_link="https://example.com/file.pdf",
            uploaded=datetime.date(2024, 1, 1),
        )

        mock_version_set = MagicMock()
        mock_version_set.version_set_id = "vs1"

        filters = FileNameFilter(extensions=["ifc"], contains=["LLYN.B250_K01_F03"])

        with patch.object(api, "get_version_sets", return_value=[mock_version_set]):
            with patch.object(api, "list_version_set_files", return_value=[file_obj]):
                with patch.object(api, "_client") as mock_client:
                    mock_client._configuration.api_key = "test_key"
                    mock_download.return_value = file_obj

                    result = api.download_files(
                        identifiers=[filters],
                        version_set_ids=["vs1"],
                        project_id="p1",
                    )

        assert len(result.downloaded_files) == 1
        assert result.downloaded_files[0].file_name == "LLYN.B250_K01_F03.ifc"
        assert result.missing_report["vs1"].missing_files == []

    @patch("dalux_build.api.version_sets.download_file_with_metadata")
    def test_skip_no_download_link(self, mock_download):
        """Test files without download links are skipped."""
        api = self._make_api()

        # Create file without download link
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
            download_link=None,
        )

        mock_version_set = MagicMock()
        mock_version_set.version_set_id = "vs1"

        with patch.object(api, "get_version_sets", return_value=[mock_version_set]):
            with patch.object(api, "list_version_set_files", return_value=[file_obj]):
                result = api.download_files(
                    identifiers=["test.pdf"],
                    version_set_ids=None,
                    project_id="p1",
                )

        assert len(result.downloaded_files) == 0
        assert len(result.skipped_files) == 1
        assert result.skipped_files[0].file_name == "test.pdf"
        assert "vs1" in result.missing_report
        assert "test.pdf" in result.missing_report["vs1"].missing_download_links

    @patch("dalux_build.api.version_sets.download_file_with_metadata")
    def test_missing_files_reported(self, mock_download):
        """Test missing files are reported."""
        api = self._make_api()

        # Create file with different name
        file_obj = File(
            file_id="S123456",
            file_name="other.pdf",
            file_area_id="fa1",
            download_link="https://example.com/other.pdf",
        )

        mock_version_set = MagicMock()
        mock_version_set.version_set_id = "vs1"

        with patch.object(api, "get_version_sets", return_value=[mock_version_set]):
            with patch.object(api, "list_version_set_files", return_value=[file_obj]):
                result = api.download_files(
                    identifiers=["test.pdf"],
                    version_set_ids=None,
                    project_id="p1",
                )

        assert len(result.downloaded_files) == 0
        assert "vs1" in result.missing_report
        assert "test.pdf" in result.missing_report["vs1"].missing_files

    def test_specific_version_sets(self):
        """Test downloading from specific version sets."""
        api = self._make_api()

        mock_version_set = MagicMock()
        mock_version_set.version_set_id = "vs1"

        with patch.object(api, "get_version_sets") as mock_get_vs:
            with patch.object(api, "list_version_set_files", return_value=[]):
                result = api.download_files(
                    identifiers=["test.pdf"],
                    version_set_ids=["vs1"],
                    project_id="p1",
                )

        # Should not call get_version_sets when version_set_ids is provided
        mock_get_vs.assert_not_called()
        assert "vs1" in result.missing_report


class TestVersionSetsApiGetFilesMissing:
    """Test get_files_missing_from_version_sets method."""

    def _make_api(self):
        """Create a VersionSetsApi instance for testing."""
        mock_client = MagicMock()
        mock_client.configuration.api_key = "test_key"
        from dalux_build.api.version_sets import VersionSetsApi

        return VersionSetsApi(mock_client)

    def test_empty_version_sets(self):
        """Test with empty version_set_ids list."""
        api = self._make_api()

        result = api.get_files_missing_from_version_sets(
            identifiers=["test.pdf"],
            version_set_ids=[],
            project_id="p1",
        )

        assert len(result) == 0

    def test_missing_files(self):
        """Test identification of missing files."""
        api = self._make_api()

        # Create file with different name
        file_obj = File(
            file_id="S123456",
            file_name="other.pdf",
            file_area_id="fa1",
        )

        with patch.object(api, "list_version_set_files", return_value=[file_obj]):
            result = api.get_files_missing_from_version_sets(
                identifiers=["test.pdf", "missing.pdf"],
                version_set_ids=["vs1"],
                project_id="p1",
            )

        assert "vs1" in result
        assert "test.pdf" in result["vs1"].missing_files
        assert "missing.pdf" in result["vs1"].missing_files

    def test_missing_download_links(self):
        """Test identification of files without download links."""
        api = self._make_api()

        # Create file without download link
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
            download_link=None,
        )

        with patch.object(api, "list_version_set_files", return_value=[file_obj]):
            result = api.get_files_missing_from_version_sets(
                identifiers=["test.pdf"],
                version_set_ids=["vs1"],
                project_id="p1",
            )

        assert "vs1" in result
        assert "test.pdf" in result["vs1"].missing_download_links

    def test_found_files(self):
        """Test files that are found are not in missing lists."""
        api = self._make_api()

        # Create file with matching name and download link
        file_obj = File(
            file_id="S123456",
            file_name="test.pdf",
            file_area_id="fa1",
            download_link="https://example.com/test.pdf",
        )

        with patch.object(api, "list_version_set_files", return_value=[file_obj]):
            result = api.get_files_missing_from_version_sets(
                identifiers=["test.pdf", "missing.pdf"],
                version_set_ids=["vs1"],
                project_id="p1",
            )

        assert "vs1" in result
        assert "test.pdf" not in result["vs1"].missing_files
        assert "test.pdf" not in result["vs1"].missing_download_links
        assert "missing.pdf" in result["vs1"].missing_files


class TestDownloadUtility:
    """Test shared download utilities."""

    def test_build_local_name_without_historical(self):
        """Test build_local_name without historical saving."""
        from dalux_build.utils.download import build_local_name

        file_obj = File(
            file_id="S1",
            file_name="test.pdf",
            file_area_id="fa1",
            uploaded=datetime.date(2024, 1, 15),
        )

        result = build_local_name(file_obj, save_historically=False)
        assert result == "test.pdf"

    def test_build_local_name_with_historical(self):
        """Test build_local_name with historical saving."""
        from dalux_build.utils.download import build_local_name

        file_obj = File(
            file_id="S1",
            file_name="test.pdf",
            file_area_id="fa1",
            uploaded=datetime.date(2024, 1, 15),
        )

        result = build_local_name(file_obj, save_historically=True)
        assert result == "test_20240115000000.pdf"

    def test_build_local_name_no_upload_date(self):
        """Test build_local_name when file has no upload date."""
        from dalux_build.utils.download import build_local_name

        file_obj = File(
            file_id="S1",
            file_name="test.pdf",
            file_area_id="fa1",
            uploaded=None,
        )

        result = build_local_name(file_obj, save_historically=True)
        assert result == "test.pdf"

    def test_get_local_file_path(self):
        """Test get_local_file_path utility."""
        from dalux_build.utils.download import get_local_file_path

        result = get_local_file_path("test.pdf", save_path="/tmp/downloads")
        assert result == "/tmp/downloads/test.pdf"

        result = get_local_file_path("test.pdf", save_path=None)
        assert result == "test.pdf"

    def test_get_local_metadata_path(self):
        """Test get_local_metadata_path utility."""
        from dalux_build.utils.download import get_local_metadata_path

        result = get_local_metadata_path("test.pdf", save_path="/tmp/downloads")
        assert result == "/tmp/downloads/test.pdf.txt"
