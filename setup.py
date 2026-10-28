from setuptools import find_packages, setup

setup(
    name="quotexpy-local",
    version="0.1.1",
    description="Local QuotexPy package used by Quotex Signal Lab",
    packages=find_packages(include=("quotexpy", "quotexpy.*")),
    include_package_data=True,
    python_requires=">=3.10",
)
